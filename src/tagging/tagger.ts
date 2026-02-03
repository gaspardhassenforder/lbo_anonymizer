import type { DetectedSpan, EntityLabel, TagEntry } from '../types'
import { normalizeText } from './normalize'

/**
 * Generate a tag string from label and index
 * e.g., [PERSON_1], [EMAIL_3]
 */
export function generateTag(label: EntityLabel, index: number): string {
  return `[${label}_${index}]`
}

/**
 * Parse a tag string back to label and index
 */
export function parseTag(tag: string): { label: EntityLabel; index: number } | null {
  const match = tag.match(/^\[([A-Z_]+)_(\d+)\]$/)
  if (!match) return null

  return {
    label: match[1] as EntityLabel,
    index: parseInt(match[2], 10),
  }
}

/**
 * Build a tag map from spans
 * Maps normalized text to tag entries
 * Ensures stable ordering: same text always gets same tag number
 */
export function buildTagMap(spans: DetectedSpan[]): Map<string, TagEntry> {
  const tagMap = new Map<string, TagEntry>()
  const labelCounters = new Map<EntityLabel, number>()

  // Sort spans by first occurrence (page, then position)
  const sortedSpans = [...spans].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex
    return a.charStart - b.charStart
  })

  for (const span of sortedSpans) {
    const normalized = normalizeText(span.text)

    if (!tagMap.has(normalized)) {
      // Get next counter for this label
      const counter = (labelCounters.get(span.label) || 0) + 1
      labelCounters.set(span.label, counter)

      tagMap.set(normalized, {
        tag: generateTag(span.label, counter),
        label: span.label,
        originalTexts: new Set([span.text]),
        count: 1,
      })
    } else {
      const entry = tagMap.get(normalized)!
      entry.originalTexts.add(span.text)
      entry.count++
    }
  }

  return tagMap
}

/**
 * Get the tag for a span's text
 */
export function getTagForSpan(
  span: DetectedSpan,
  tagMap: Map<string, TagEntry>
): string {
  const normalized = normalizeText(span.text)
  const entry = tagMap.get(normalized)
  return entry?.tag ?? `[${span.label}_UNKNOWN]`
}

/**
 * Anonymize text by replacing entity spans with tags
 */
export function anonymizeText(
  text: string,
  spans: DetectedSpan[],
  tagMap: Map<string, TagEntry>
): string {
  // Sort spans by position (reverse order for replacement)
  const sortedSpans = [...spans].sort((a, b) => b.charStart - a.charStart)

  let result = text

  for (const span of sortedSpans) {
    const tag = getTagForSpan(span, tagMap)
    result = result.slice(0, span.charStart) + tag + result.slice(span.charEnd)
  }

  return result
}

/**
 * Get summary of entities by label
 */
export function getEntitySummary(
  tagMap: Map<string, TagEntry>
): Record<EntityLabel, number> {
  const summary: Partial<Record<EntityLabel, number>> = {}

  for (const entry of tagMap.values()) {
    summary[entry.label] = (summary[entry.label] || 0) + entry.count
  }

  return summary as Record<EntityLabel, number>
}

/**
 * Get unique entity count by label
 */
export function getUniqueEntityCount(
  tagMap: Map<string, TagEntry>
): Record<EntityLabel, number> {
  const counts: Partial<Record<EntityLabel, number>> = {}

  for (const entry of tagMap.values()) {
    counts[entry.label] = (counts[entry.label] || 0) + 1
  }

  return counts as Record<EntityLabel, number>
}

/**
 * Convert tag map to serializable format
 */
export function tagMapToObject(
  tagMap: Map<string, TagEntry>
): Record<string, { tag: string; label: EntityLabel; count: number }> {
  const result: Record<string, { tag: string; label: EntityLabel; count: number }> = {}

  for (const [key, entry] of tagMap) {
    result[key] = {
      tag: entry.tag,
      label: entry.label,
      count: entry.count,
    }
  }

  return result
}

/**
 * Create reverse mapping: tag -> original texts
 */
export function createReverseTagMap(
  tagMap: Map<string, TagEntry>
): Map<string, Set<string>> {
  const reverseMap = new Map<string, Set<string>>()

  for (const entry of tagMap.values()) {
    reverseMap.set(entry.tag, entry.originalTexts)
  }

  return reverseMap
}
