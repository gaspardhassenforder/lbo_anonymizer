/**
 * Normalize text for consistent tag mapping
 * - Trim whitespace
 * - Collapse multiple spaces
 * - Convert to lowercase
 */
export function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * Normalize text preserving case (for display)
 */
export function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/**
 * Check if two texts are equivalent after normalization
 */
export function textsMatch(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b)
}

/**
 * Remove diacritics from text (for fuzzy matching)
 */
export function removeDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Normalize for fuzzy matching
 * - Remove diacritics
 * - Lowercase
 * - Remove punctuation
 * - Collapse whitespace
 */
export function normalizeForFuzzy(text: string): string {
  return removeDiacritics(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Calculate similarity between two strings (0-1)
 * Uses Levenshtein distance normalized by max length
 */
export function textSimilarity(a: string, b: string): number {
  const normalA = normalizeForFuzzy(a)
  const normalB = normalizeForFuzzy(b)

  if (normalA === normalB) return 1

  const maxLen = Math.max(normalA.length, normalB.length)
  if (maxLen === 0) return 1

  const distance = levenshteinDistance(normalA, normalB)
  return 1 - distance / maxLen
}

/**
 * Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}
