import type { DetectedSpan, Token, EntityLabel } from '../types'
import { findTokensInRange } from '../pdf/textExtraction'

interface RawSpan {
  label: DetectedSpan['label']
  text: string
  normalizedText: string
  confidence: number
  source: DetectedSpan['source']
  pageIndex: number
  charStart: number
  charEnd: number
}

/**
 * Check if two spans overlap
 */
function spansOverlap(a: RawSpan, b: RawSpan): boolean {
  if (a.pageIndex !== b.pageIndex) return false
  return a.charEnd > b.charStart && a.charStart < b.charEnd
}

/**
 * Calculate overlap ratio between two spans
 */
function overlapRatio(a: RawSpan, b: RawSpan): number {
  if (!spansOverlap(a, b)) return 0

  const overlapStart = Math.max(a.charStart, b.charStart)
  const overlapEnd = Math.min(a.charEnd, b.charEnd)
  const overlapLength = overlapEnd - overlapStart

  const minLength = Math.min(a.charEnd - a.charStart, b.charEnd - b.charStart)
  return overlapLength / minLength
}

/**
 * Score a span for overlap resolution
 * Higher score = preferred
 */
function scoreSpan(span: RawSpan): number {
  let score = span.confidence * 100

  // Prefer NER over regex for semantic entities
  if (span.source === 'ner') {
    score += 10
  }

  // Prefer user edits over everything
  if (span.source === 'user') {
    score += 1000
  }

  // Prefer longer spans (more context)
  score += (span.charEnd - span.charStart) * 0.1

  return score
}

/**
 * Merge overlapping spans, keeping the best ones
 * Rules:
 * 1. User edits always win
 * 2. Higher confidence wins
 * 3. NER preferred over regex for ties
 * 4. Longer spans preferred for ties
 */
export function mergeOverlappingSpans(spans: RawSpan[]): RawSpan[] {
  if (spans.length === 0) return []

  // Sort by page, then by start position
  const sorted = [...spans].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex
    if (a.charStart !== b.charStart) return a.charStart - b.charStart
    return scoreSpan(b) - scoreSpan(a) // Higher score first
  })

  const result: RawSpan[] = []

  for (const span of sorted) {
    // Find overlapping spans in result
    const overlapping = result.filter(
      (existing) => spansOverlap(existing, span) && overlapRatio(existing, span) > 0.5
    )

    if (overlapping.length === 0) {
      // No significant overlap, add the span
      result.push(span)
    } else {
      // Check if this span should replace any overlapping ones
      const spanScore = scoreSpan(span)
      let shouldAdd = true

      for (const existing of overlapping) {
        const existingScore = scoreSpan(existing)

        if (existingScore >= spanScore) {
          // Existing span is better or equal, don't add
          shouldAdd = false
          break
        }
      }

      if (shouldAdd) {
        // Remove lower-scoring overlapping spans
        for (const existing of overlapping) {
          const idx = result.indexOf(existing)
          if (idx !== -1) {
            result.splice(idx, 1)
          }
        }
        result.push(span)
      }
    }
  }

  return result
}

/**
 * Deduplicate exact same spans (same position and label)
 */
export function deduplicateSpans(spans: RawSpan[]): RawSpan[] {
  const seen = new Set<string>()
  return spans.filter((span) => {
    const key = `${span.pageIndex}-${span.charStart}-${span.charEnd}-${span.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Process raw spans: deduplicate, merge overlaps, and attach tokens
 */
export function processSpans(
  rawSpans: RawSpan[],
  tokens: Token[],
  pageIndex: number
): DetectedSpan[] {
  // Filter to current page
  const pageSpans = rawSpans.filter((s) => s.pageIndex === pageIndex)

  // Deduplicate exact matches
  const deduplicated = deduplicateSpans(pageSpans)

  // Merge overlapping spans
  const merged = mergeOverlappingSpans(deduplicated)

  // Attach tokens that overlap with the span's character range
  return merged.map((span, index) => {
    const matchedTokens = findTokensInRange(tokens, span.charStart, span.charEnd)

    // Debug: log what tokens are matched for each span with bbox info
    console.log(`[Span] "${span.text}" (${span.charStart}-${span.charEnd}) matched ${matchedTokens.length} tokens:`)
    matchedTokens.forEach(t => {
      console.log(`  "${t.text}" chars ${t.charStart}-${t.charEnd}, bbox: x=${t.bbox.x.toFixed(1)} w=${t.bbox.width.toFixed(1)}`)
    })

    return {
      ...span,
      id: `span-${pageIndex}-${index}-${Date.now()}`,
      tokens: matchedTokens,
    }
  })
}

/**
 * Combine spans from multiple sources (NER + regex)
 */
export function combineDetectionResults(
  nerSpans: RawSpan[],
  regexSpans: RawSpan[]
): RawSpan[] {
  const combined = [...nerSpans, ...regexSpans]
  const deduplicated = deduplicateSpans(combined)
  return mergeOverlappingSpans(deduplicated)
}

/**
 * Apply user decisions (suppressions and label overrides) to raw spans.
 * This filters out suppressed texts and applies label overrides to matching spans.
 */
export function applyUserDecisions(
  spans: RawSpan[],
  suppressedTexts: Set<string>,
  labelOverrides: Map<string, EntityLabel>
): RawSpan[] {
  return spans
    // Filter out suppressed texts
    .filter((span) => !suppressedTexts.has(span.normalizedText))
    // Apply label overrides
    .map((span) => {
      const override = labelOverrides.get(span.normalizedText)
      if (override) {
        return { ...span, label: override }
      }
      return span
    })
}
