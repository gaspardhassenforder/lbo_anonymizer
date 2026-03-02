/**
 * Known False Positives
 *
 * Strings that the NER model or regex patterns consistently misidentify as
 * requiring anonymization, but which should NOT be anonymized.
 *
 * HOW TO ADD A NEW ENTRY
 * ----------------------
 * When a user reports a false positive, add it to the list below with:
 *   - text:  The exact string as it appears in documents (case-insensitive match)
 *   - label: The entity label it was incorrectly detected as
 *   - notes: Why it is a false positive (optional but recommended)
 *
 * Strings are normalized to lowercase + collapsed whitespace before comparison,
 * so "  Example  " and "example" are treated as the same entry.
 *
 * These suppressions are applied at startup for all users and cannot be
 * overridden by the user's own corpus rules.
 */

export interface KnownFalsePositive {
  /** The string as it appears in documents (case-insensitive) */
  text: string
  /** The entity label it was incorrectly detected as */
  label: 'PERSON' | 'ORGANIZATION' | 'ADDRESS' | 'DATE' | 'IDENTIFIER'
  /** Why this is a false positive */
  notes?: string
}

export const KNOWN_FALSE_POSITIVES: KnownFalsePositive[] = [
  // ── Add new false positives below ────────────────────────────────────────

  // Generic role/party references in LBO legal documents (not named entities)
  { text: "l'investisseur",            label: 'ORGANIZATION', notes: "Generic reference to 'the investor', not a named entity" },
  { text: "l'acquéreur",               label: 'ORGANIZATION', notes: "Generic reference to 'the acquirer', not a named entity" },
  { text: "l'investisseur financier",  label: 'ORGANIZATION', notes: "Generic reference to 'the financial investor', not a named entity" },
  { text: "l'investisseur financier.", label: 'ORGANIZATION', notes: "Same as above with trailing period" },
  { text: 'société',                   label: 'ORGANIZATION', notes: "Generic French word for 'company', not a named entity" },
  { text: 'filiales',                  label: 'ORGANIZATION', notes: "Generic French word for 'subsidiaries', not a named entity" },
  { text: 'groupe',                    label: 'ORGANIZATION', notes: "Generic French word for 'group', not a named entity" },
  { text: 'entité',                    label: 'ORGANIZATION', notes: "Generic French word for 'entity', not a named entity" },

  // ─────────────────────────────────────────────────────────────────────────
]

/**
 * Returns the normalized texts to add to the global `suppressedTexts` set.
 * Normalization matches the store's `normalizeText()` function:
 *   trim → lowercase → collapse whitespace
 */
export function getKnownFalsePositiveTexts(): string[] {
  return KNOWN_FALSE_POSITIVES.map((fp) =>
    fp.text.trim().toLowerCase().replace(/\s+/g, ' ')
  )
}
