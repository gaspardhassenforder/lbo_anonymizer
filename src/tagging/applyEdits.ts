import type { DetectedSpan, EntityLabel, Token, EditAction } from '../types'
import { normalizeText } from './normalize'
import { findTokensInRange } from '../pdf/textExtraction'

/**
 * Generate a unique ID for a new span
 */
function generateSpanId(): string {
  return `span-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create a new span from user selection
 */
export function createSpan(
  text: string,
  label: EntityLabel,
  pageIndex: number,
  charStart: number,
  charEnd: number,
  tokens: Token[]
): DetectedSpan {
  return {
    id: generateSpanId(),
    label,
    text,
    normalizedText: normalizeText(text),
    confidence: 1.0, // User-created spans have max confidence
    source: 'user',
    pageIndex,
    charStart,
    charEnd,
    tokens: findTokensInRange(tokens, charStart, charEnd),
  }
}

/**
 * Apply an edit action to the spans array
 * Returns a new array (immutable)
 */
export function applyEdit(
  spans: DetectedSpan[],
  action: EditAction
): DetectedSpan[] {
  switch (action.type) {
    case 'ADD_SPAN':
      return [...spans, action.span]

    case 'REMOVE_SPAN':
      return spans.filter((s) => s.id !== action.spanId)

    case 'CHANGE_LABEL': {
      return spans.map((span) => {
        if (span.id === action.spanId) {
          return {
            ...span,
            label: action.newLabel,
            // Update source to user since they modified it
            source: 'user' as const,
          }
        }
        return span
      })
    }

    case 'EXTEND_SPAN':
      return spans.map((s) =>
        s.id === action.spanId
          ? { ...s, charStart: action.charStart, charEnd: action.charEnd, text: action.text, tokens: action.tokens, source: 'user' as const }
          : s
      )
  }
}

/**
 * Apply multiple edit actions
 */
export function applyEdits(
  spans: DetectedSpan[],
  actions: EditAction[]
): DetectedSpan[] {
  return actions.reduce((acc, action) => applyEdit(acc, action), spans)
}

/**
 * Find span at a specific position
 */
export function findSpanAtPosition(
  spans: DetectedSpan[],
  pageIndex: number,
  charOffset: number
): DetectedSpan | undefined {
  return spans.find(
    (span) =>
      span.pageIndex === pageIndex &&
      charOffset >= span.charStart &&
      charOffset < span.charEnd
  )
}

/**
 * Find spans that overlap with a character range
 */
export function findOverlappingSpans(
  spans: DetectedSpan[],
  pageIndex: number,
  charStart: number,
  charEnd: number
): DetectedSpan[] {
  return spans.filter(
    (span) =>
      span.pageIndex === pageIndex &&
      span.charEnd > charStart &&
      span.charStart < charEnd
  )
}

/**
 * Check if a new span would overlap with existing spans
 */
export function hasOverlap(
  spans: DetectedSpan[],
  pageIndex: number,
  charStart: number,
  charEnd: number,
  excludeId?: string
): boolean {
  return spans.some(
    (span) =>
      span.id !== excludeId &&
      span.pageIndex === pageIndex &&
      span.charEnd > charStart &&
      span.charStart < charEnd
  )
}

/**
 * Merge a new span with existing spans if they overlap
 * Returns the merged span or the original if no merge needed
 */
export function mergeWithExisting(
  newSpan: DetectedSpan,
  existingSpans: DetectedSpan[]
): { span: DetectedSpan; toRemove: string[] } {
  const overlapping = findOverlappingSpans(
    existingSpans,
    newSpan.pageIndex,
    newSpan.charStart,
    newSpan.charEnd
  )

  if (overlapping.length === 0) {
    return { span: newSpan, toRemove: [] }
  }

  // Expand the new span to cover all overlapping spans
  let minStart = newSpan.charStart
  let maxEnd = newSpan.charEnd

  for (const span of overlapping) {
    minStart = Math.min(minStart, span.charStart)
    maxEnd = Math.max(maxEnd, span.charEnd)
  }

  // Create merged span (keep the new span's label and properties)
  const mergedSpan: DetectedSpan = {
    ...newSpan,
    charStart: minStart,
    charEnd: maxEnd,
    // Recalculate tokens would require page text
  }

  return {
    span: mergedSpan,
    toRemove: overlapping.map((s) => s.id),
  }
}

/**
 * Split a span at a position
 * Useful for removing part of a span
 */
export function splitSpan(
  span: DetectedSpan,
  splitStart: number,
  splitEnd: number,
  pageText: string,
  tokens: Token[]
): DetectedSpan[] {
  const result: DetectedSpan[] = []

  // Left part
  if (splitStart > span.charStart) {
    const leftText = pageText.slice(span.charStart, splitStart)
    result.push(
      createSpan(
        leftText,
        span.label,
        span.pageIndex,
        span.charStart,
        splitStart,
        tokens
      )
    )
  }

  // Right part
  if (splitEnd < span.charEnd) {
    const rightText = pageText.slice(splitEnd, span.charEnd)
    result.push(
      createSpan(
        rightText,
        span.label,
        span.pageIndex,
        splitEnd,
        span.charEnd,
        tokens
      )
    )
  }

  return result
}
