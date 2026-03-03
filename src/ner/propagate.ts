import type { DetectedSpan, PageModel, EntityLabel } from '../types'
import { findTokensInRange } from '../pdf/textExtraction'
import { normalizeText, normalizeForFuzzy, textSimilarity } from '../tagging/normalize'

// "Same" entity for propagation: group spans with ≥95% fuzzy similarity
const FUZZY_SAME_THRESHOLD = 0.95

// Minimum similarity for finding occurrences on page (markdown / slight variants)
const FUZZY_MATCH_THRESHOLD = 0.85

// Characters commonly found in markdown/formatting that should be stripped for matching
const MARKDOWN_CHARS_PATTERN = /[*_~`#\[\](){}|\\<>]/g

// Single-char pattern for testing (no global flag)
const MARKDOWN_CHAR_TEST = /[*_~`#\[\](){}|\\<>]/

/**
 * Strip markdown formatting characters from text
 */
function stripMarkdown(text: string): string {
  return text.replace(MARKDOWN_CHARS_PATTERN, '')
}

/**
 * Build a flexible regex pattern that allows optional markdown characters between words
 * For "Marc LEBLANC", creates pattern: M[*_~`]*a[*_~`]*r[*_~`]*c[*_~`]*\s+[*_~`]*L[*_~`]*E...
 */
function buildFlexiblePattern(searchText: string): RegExp {
  // Normalize the search text first
  const normalized = searchText.trim()

  // Split into words
  const words = normalized.split(/\s+/)

  // For each word, allow optional non-word chars between letters
  // Between words, require at least one whitespace (possibly with markdown)
  const wordPatterns = words.map(word => {
    // Split into characters first, THEN escape each character individually
    const chars = word.split('').map(char => {
      // Escape special regex characters
      return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    // Allow optional markdown chars between each character
    return chars.join('[*_~`]*')
  })

  // Join words with flexible whitespace pattern (allows markdown around spaces)
  const pattern = wordPatterns.join('[*_~`]*\\s+[*_~`]*')

  return new RegExp(pattern, 'gi')
}

/**
 * Find the tightest bounds within a matched text that contain the actual entity
 * This strips leading/trailing markdown characters to get precise highlighting
 */
function getTightBounds(
  pageText: string,
  matchStart: number,
  matchEnd: number,
  searchText: string
): { start: number; end: number } {
  const matchedText = pageText.slice(matchStart, matchEnd)

  // Find where the actual content starts (skip leading markdown)
  let contentStart = 0
  while (contentStart < matchedText.length && MARKDOWN_CHAR_TEST.test(matchedText[contentStart])) {
    contentStart++
  }

  // Find where the actual content ends (skip trailing markdown/punctuation)
  let contentEnd = matchedText.length
  const trailingChars = /[*_~`#\[\](){}|\\<>,.;:!?]/
  while (contentEnd > contentStart && trailingChars.test(matchedText[contentEnd - 1])) {
    contentEnd--
  }

  // If we stripped too much, fall back to original bounds
  if (contentEnd - contentStart < searchText.length * 0.5) {
    return { start: matchStart, end: matchEnd }
  }

  return {
    start: matchStart + contentStart,
    end: matchStart + contentEnd,
  }
}

/**
 * Find all occurrences of a search text within a page text
 * Supports fuzzy matching to handle markdown formatting like **text**
 * Returns an array of { start, end } positions with tight bounds around actual text
 */
export function findAllOccurrences(
  pageText: string,
  searchText: string
): Array<{ start: number; end: number }> {
  const occurrences: Array<{ start: number; end: number }> = []

  if (!searchText || !pageText) return occurrences

  // First try exact case-insensitive matching
  const normalizedPageText = pageText.toLowerCase()
  const normalizedSearchText = searchText.toLowerCase()

  let startIndex = 0
  while (true) {
    const index = normalizedPageText.indexOf(normalizedSearchText, startIndex)
    if (index === -1) break

    occurrences.push({
      start: index,
      end: index + searchText.length,
    })
    startIndex = index + 1
  }

  // If exact matching found results, return them
  if (occurrences.length > 0) {
    return occurrences
  }

  // Try flexible pattern matching for markdown-wrapped text
  const flexPattern = buildFlexiblePattern(searchText)
  let match: RegExpExecArray | null

  while ((match = flexPattern.exec(pageText)) !== null) {
    const matchedText = match[0]
    const rawStart = match.index
    const rawEnd = rawStart + matchedText.length

    // Verify the match is good enough using similarity check
    const strippedMatch = stripMarkdown(matchedText)
    const strippedSearch = stripMarkdown(searchText)
    const similarity = textSimilarity(strippedMatch, strippedSearch)

    if (similarity >= FUZZY_MATCH_THRESHOLD) {
      // Get tight bounds that exclude surrounding markdown
      const tightBounds = getTightBounds(pageText, rawStart, rawEnd, searchText)
      occurrences.push(tightBounds)
    }

    // Prevent infinite loop on zero-length matches
    if (match.index === flexPattern.lastIndex) {
      flexPattern.lastIndex++
    }
  }

  return occurrences
}

/**
 * Check if a position on a page is already covered by an existing span
 */
export function isPositionCovered(
  pageIndex: number,
  charStart: number,
  charEnd: number,
  spans: DetectedSpan[]
): boolean {
  return spans.some(
    (span) =>
      span.pageIndex === pageIndex &&
      // Check for overlap (not just containment)
      span.charStart < charEnd &&
      span.charEnd > charStart
  )
}

/**
 * Generate a unique span ID
 */
function generateSpanId(): string {
  return `span-prop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

interface UniqueEntity {
  text: string
  normalizedText: string
  /** All variant texts in this fuzzy group (for searching pages) */
  variants: Set<string>
  label: EntityLabel
  confidence: number
  source: 'ner' | 'regex' | 'user'
}

/**
 * Group detected spans into unique entities by 95% fuzzy similarity.
 * Two spans are "same" if normalizeForFuzzy + textSimilarity ≥ FUZZY_SAME_THRESHOLD.
 */
function buildUniqueEntitiesFuzzy(spans: DetectedSpan[]): UniqueEntity[] {
  const entities: UniqueEntity[] = []
  for (const span of spans) {
    const normSpan = normalizeForFuzzy(span.text)
    const found = entities.find(
      (e) => textSimilarity(normalizeForFuzzy(e.text), normSpan) >= FUZZY_SAME_THRESHOLD
    )
    if (found) {
      found.variants.add(span.text)
      if (span.confidence > found.confidence) {
        found.text = span.text
        found.normalizedText = span.normalizedText
        found.confidence = span.confidence
      }
    } else {
      entities.push({
        text: span.text,
        normalizedText: span.normalizedText,
        variants: new Set([span.text]),
        label: span.label,
        confidence: span.confidence,
        source: span.source,
      })
    }
  }

  return entities
}

/**
 * Propagate detected entities across all pages
 *
 * This function:
 * 1. Groups spans into unique entities by 95% fuzzy similarity ("same" = fuzzy match)
 * 2. Searches all pages for occurrences of each entity (all variants)
 * 3. Creates new spans for undetected occurrences
 * 4. Returns only the NEW propagated spans (not the original ones)
 */
export function propagateEntities(
  detectedSpans: DetectedSpan[],
  pages: PageModel[]
): DetectedSpan[] {
  const uniqueEntities = buildUniqueEntitiesFuzzy(detectedSpans)
  const propagatedSpans: DetectedSpan[] = []

  for (const entity of uniqueEntities) {
    for (const page of pages) {
      const seenPositions = new Set<string>()
      for (const variant of entity.variants) {
        const occurrences = findAllOccurrences(page.text, variant)

        for (const occurrence of occurrences) {
          const posKey = `${occurrence.start}-${occurrence.end}`
          if (seenPositions.has(posKey)) continue
          seenPositions.add(posKey)

          const alreadyCovered = isPositionCovered(
            page.pageIndex,
            occurrence.start,
            occurrence.end,
            [...detectedSpans, ...propagatedSpans]
          )

          if (!alreadyCovered) {
            const tokens = findTokensInRange(
              page.tokens,
              occurrence.start,
              occurrence.end
            )

            const actualText = page.text.slice(occurrence.start, occurrence.end)

            // Log when no tokens found but text exists (debugging)
            if (tokens.length === 0) {
              console.warn(`[Propagation] No tokens for "${actualText}" at ${occurrence.start}-${occurrence.end} on page ${page.pageIndex}. Creating span anyway.`)
            }

            const newSpan: DetectedSpan = {
              id: generateSpanId(),
              label: entity.label,
              text: actualText,
              normalizedText: normalizeText(actualText),
              tokens, // May be empty, but span still valid for char-based highlighting
              confidence: entity.confidence * 0.9,
              source: entity.source,
              pageIndex: page.pageIndex,
              charStart: occurrence.start,
              charEnd: occurrence.end,
            }

            propagatedSpans.push(newSpan)
          }
        }
      }
    }
  }

  console.log(`[Propagation] Created ${propagatedSpans.length} new spans from ${uniqueEntities.length} unique entities (95% fuzzy grouping)`)

  return propagatedSpans
}

/**
 * Propagate existing entities to a single new page.
 * Used for incremental processing where pages are processed one at a time.
 * "Same" entity = 95% fuzzy similarity.
 *
 * @param existingSpans - All spans detected so far (from previous pages)
 * @param newPage - The new page to search for entity occurrences
 * @param suppressedTexts - Optional set of normalized texts to skip (user has removed these)
 * @param labelOverrides - Optional map of normalized text to forced label (user changed label)
 * @returns New propagated spans found on this page only
 */
export function propagateEntitiesForPage(
  existingSpans: DetectedSpan[],
  newPage: PageModel,
  suppressedTexts?: Set<string>,
  labelOverrides?: Map<string, EntityLabel>
): DetectedSpan[] {
  const uniqueEntities = buildUniqueEntitiesFuzzy(existingSpans)
  const propagatedSpans: DetectedSpan[] = []

  for (const entity of uniqueEntities) {
    const seenPositions = new Set<string>()
    for (const variant of entity.variants) {
      const occurrences = findAllOccurrences(newPage.text, variant)

      for (const occurrence of occurrences) {
        const posKey = `${occurrence.start}-${occurrence.end}`
        if (seenPositions.has(posKey)) continue
        seenPositions.add(posKey)
        const existingOnThisPage = existingSpans.filter((s) => s.pageIndex === newPage.pageIndex)
        const alreadyCovered = isPositionCovered(
          newPage.pageIndex,
          occurrence.start,
          occurrence.end,
          [...existingOnThisPage, ...propagatedSpans]
        )

        if (!alreadyCovered) {
          const tokens = findTokensInRange(
            newPage.tokens,
            occurrence.start,
            occurrence.end
          )

          const actualText = newPage.text.slice(occurrence.start, occurrence.end)
          const normalizedActualText = normalizeText(actualText)

          // Skip if this text is suppressed by user
          if (suppressedTexts?.has(normalizedActualText)) {
            continue
          }

          // Log when no tokens found but text exists (debugging)
          if (tokens.length === 0) {
            console.warn(`[Propagation] No tokens for "${actualText}" at ${occurrence.start}-${occurrence.end} on page ${newPage.pageIndex}. Creating span anyway.`)
          }

          // Apply label override if user changed label
          const finalLabel = labelOverrides?.get(normalizedActualText) ?? entity.label

          const newSpan: DetectedSpan = {
            id: generateSpanId(),
            label: finalLabel,
            text: actualText,
            normalizedText: normalizedActualText,
            tokens, // May be empty, but span still valid for char-based highlighting
            confidence: entity.confidence * 0.9,
            source: entity.source,
            pageIndex: newPage.pageIndex,
            charStart: occurrence.start,
            charEnd: occurrence.end,
          }

          propagatedSpans.push(newSpan)
        }
      }
    }
  }

  if (propagatedSpans.length > 0) {
    console.log(`[Propagation] Created ${propagatedSpans.length} new spans on page ${newPage.pageIndex} from ${uniqueEntities.length} unique entities (95% fuzzy grouping)`)
  }

  return propagatedSpans
}
