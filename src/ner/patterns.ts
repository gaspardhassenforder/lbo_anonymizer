import type { EntityLabel, DetectedSpan } from '../types'

// ===== EXCLUSION PATTERNS =====

// Document IDs (DocuSign, UUIDs)
const UUID_PATTERN = /[A-F0-9]{8}-[A-F0-9]{4}-[0-9A-F]{4}-[A-F0-9]{4}-[A-F0-9]{12}/i

// Registration numbers (B.XXXXXX format)
const REGISTRATION_NUMBER_PATTERN = /^[A-Z]\.\d{5,7}$/

// Company numbers (842 352 908 format)
const COMPANY_NUMBER_PATTERN = /^\d{3}\s+\d{3}\s+\d{3}$/

// Text containing "DocuSign", "Envelope", "ID:" etc.
const DOCUMENT_ID_KEYWORDS = /\b(docusign|envelope|signature|id:|ref:|reference)\b/i

/**
 * Check if text should be excluded from entity detection
 */
export function shouldExcludeSpan(text: string, label: EntityLabel): boolean {
  const trimmed = text.trim()

  // Reject UUIDs/DocuSign IDs
  if (UUID_PATTERN.test(trimmed)) return true

  // Reject if contains document ID keywords
  if (DOCUMENT_ID_KEYWORDS.test(trimmed)) return true

  // Reject registration numbers misclassified as ADDRESS
  if (label === 'ADDRESS' && REGISTRATION_NUMBER_PATTERN.test(trimmed)) return true

  // Reject company numbers misclassified as ADDRESS
  if (label === 'ADDRESS' && COMPANY_NUMBER_PATTERN.test(trimmed)) return true

  // PERSON-specific filters
  if (label === 'PERSON') {
    // Reject pure numbers
    if (/^\d+$/.test(trimmed)) return true
    // Reject alphanumeric IDs (8+ chars of letters/numbers/dashes)
    if (/^[A-Z0-9-]{8,}$/.test(trimmed)) return true
  }

  return false
}

interface PatternMatch {
  label: EntityLabel
  text: string
  start: number
  end: number
  confidence: number
}

// French and international phone patterns
const PHONE_PATTERNS = [
  // French formats
  /(?:(?:\+33|0033|0)\s*[1-9](?:[\s.-]*\d{2}){4})/g,
  // International with country code
  /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{0,4}/g,
]

// Email pattern
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

// French IBAN (FR + 2 check digits + 23 alphanumeric)
const IBAN_PATTERN = /\bFR\s?[0-9]{2}(?:\s?[0-9A-Z]{4}){5}\s?[0-9A-Z]{3}\b/gi

// French SIREN (9 digits)
const SIREN_PATTERN = /\b\d{3}[\s]?\d{3}[\s]?\d{3}\b/g

// French SIRET (14 digits = SIREN + NIC)
const SIRET_PATTERN = /\b\d{3}[\s]?\d{3}[\s]?\d{3}[\s]?\d{5}\b/g

// Capital amounts (euros)
const CAPITAL_PATTERN = /\b\d{1,3}(?:[\s,.]?\d{3})*(?:[,.]\d{2})?\s*(?:€|euros?|EUR)\b/gi

// Date patterns (various formats)
const DATE_PATTERNS = [
  // DD/MM/YYYY or DD-MM-YYYY
  /\b(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[012])[\/\-](19|20)\d{2}\b/g,
  // Written dates in French
  /\b(0?[1-9]|[12][0-9]|3[01])\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(19|20)\d{2}\b/gi,
]

/**
 * Validate French SIREN/SIRET using Luhn algorithm
 */
function isValidSiren(number: string): boolean {
  const digits = number.replace(/\D/g, '')
  if (digits.length !== 9 && digits.length !== 14) return false

  // Check SIREN part (first 9 digits)
  const siren = digits.slice(0, 9)
  let sum = 0

  for (let i = 0; i < 9; i++) {
    let digit = parseInt(siren[i], 10)
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }

  return sum % 10 === 0
}

/**
 * Run all regex pattern matchers on text
 */
export function detectWithPatterns(
  text: string,
  _pageIndex: number
): PatternMatch[] {
  const matches: PatternMatch[] = []

  // Helper to add unique matches
  const addMatch = (
    label: EntityLabel,
    match: RegExpExecArray,
    confidence: number,
    validator?: (text: string) => boolean
  ) => {
    const matchText = match[0]
    if (validator && !validator(matchText)) return

    // Check for duplicates
    const isDuplicate = matches.some(
      (m) => m.start === match.index && m.end === match.index + matchText.length
    )
    if (!isDuplicate) {
      matches.push({
        label,
        text: matchText,
        start: match.index,
        end: match.index + matchText.length,
        confidence,
      })
    }
  }

  // Email
  let match: RegExpExecArray | null
  const emailRegex = new RegExp(EMAIL_PATTERN.source, 'g')
  while ((match = emailRegex.exec(text)) !== null) {
    addMatch('EMAIL', match, 0.95)
  }

  // Phone numbers
  for (const pattern of PHONE_PATTERNS) {
    const phoneRegex = new RegExp(pattern.source, 'g')
    while ((match = phoneRegex.exec(text)) !== null) {
      // Filter out numbers that are too short
      if (match[0].replace(/\D/g, '').length >= 10) {
        addMatch('PHONE', match, 0.8)
      }
    }
  }

  // IBAN
  const ibanRegex = new RegExp(IBAN_PATTERN.source, 'gi')
  while ((match = ibanRegex.exec(text)) !== null) {
    addMatch('IBAN', match, 0.95)
  }

  // SIRET first (more specific, 14 digits)
  const siretRegex = new RegExp(SIRET_PATTERN.source, 'g')
  while ((match = siretRegex.exec(text)) !== null) {
    const digits = match[0].replace(/\D/g, '')
    if (digits.length === 14) {
      addMatch('SIRET', match, 0.85, isValidSiren)
    }
  }

  // SIREN (9 digits, exclude if already matched as SIRET)
  const sirenRegex = new RegExp(SIREN_PATTERN.source, 'g')
  while ((match = sirenRegex.exec(text)) !== null) {
    const digits = match[0].replace(/\D/g, '')
    if (digits.length === 9) {
      // Check if this is part of a SIRET already matched
      const isPartOfSiret = matches.some(
        (m) => m.label === 'SIRET' && match!.index >= m.start && match!.index < m.end
      )
      if (!isPartOfSiret) {
        addMatch('SIREN', match, 0.85, isValidSiren)
      }
    }
  }

  // Capital amounts
  const capitalRegex = new RegExp(CAPITAL_PATTERN.source, 'gi')
  while ((match = capitalRegex.exec(text)) !== null) {
    addMatch('CAPITAL', match, 0.85)
  }

  // Dates
  for (const pattern of DATE_PATTERNS) {
    const dateRegex = new RegExp(pattern.source, pattern.flags)
    while ((match = dateRegex.exec(text)) !== null) {
      addMatch('DATE', match, 0.7)
    }
  }

  // French address patterns (to catch full addresses GLiNER might miss)
  const FRENCH_ADDRESS_PATTERNS = [
    // Street number + type + name + postal code + city
    /\d{1,4}[,\s]+(rue|avenue|boulevard|place|allée|impasse|chemin|route)\s+[A-Za-zÀ-ÿ\s''-]+[,\s]+\d{5}\s+[A-Za-zÀ-ÿ\s-]+/gi,
    // Postal code + city (common partial format)
    /\b\d{5}\s+[A-Z][a-zà-ÿ]+(?:[-\s][A-Za-zà-ÿ]+)*\b/g,
  ]

  for (const pattern of FRENCH_ADDRESS_PATTERNS) {
    const addressRegex = new RegExp(pattern.source, pattern.flags)
    while ((match = addressRegex.exec(text)) !== null) {
      addMatch('ADDRESS', match, 0.85)
    }
  }

  return matches
}

/**
 * Convert pattern matches to DetectedSpan format
 */
export function patternMatchesToSpans(
  matches: PatternMatch[],
  pageIndex: number
): Array<Omit<DetectedSpan, 'id' | 'tokens'>> {
  return matches.map((match) => ({
    label: match.label,
    text: match.text,
    normalizedText: match.text.trim().toLowerCase().replace(/\s+/g, ' '),
    confidence: match.confidence,
    source: 'regex' as const,
    pageIndex,
    charStart: match.start,
    charEnd: match.end,
  }))
}
