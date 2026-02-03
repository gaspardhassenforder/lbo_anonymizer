import { Gliner } from 'gliner'
import type { EntityLabel, DetectedSpan } from '../types'
import { shouldExcludeSpan } from './patterns'

// Model to use - gliner_multi_pii-v1 is specifically trained for PII detection
const MODEL_ID = 'onnx-community/gliner_multi_pii-v1'
// Actual ONNX model URL - required because modelPath is passed directly to ONNX Runtime
const ONNX_MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/model_quantized.onnx`

// Entity labels to detect - these are the prompts for GLiNER
// Using multiple variations to improve detection across languages
// const GLINER_ENTITY_LABELS = [
//   // Person names - multiple prompts for better detection
//   'personne',
//   'nom',
//   'prenom',
//   // Organizations
//   'organization',
//   'entreprise',
//   'société',
//   // Locations
//   'adresse',
//   'localisation',
//   // Other PII
//   'phone number',
//   'date',
//   'capital social',
//   'credit card number',
//   'social security number',
//   'bank account',
//   'iban',
// ]

// Simplified non-overlapping labels - English works better even for French text
// because the model was primarily trained on English data
const GLINER_ENTITY_LABELS = [
  'person name and surname',
  'organization and company',
  'address and location',
]

const LABEL_MAP: Record<string, EntityLabel> = {
  'person name and surname': 'PERSON',
  'organization and company': 'ORGANIZATION',
  'address and location': 'ADDRESS',
}
// Map GLiNER labels to our EntityLabel type
// const LABEL_MAP: Record<string, EntityLabel> = {
//   'personne': 'PERSON',
//   'name': 'PERSON',
//   'full name': 'PERSON',
//   'person name': 'PERSON',
//   'organization': 'ORGANIZATION',
//   'company': 'ORGANIZATION',
//   'addresse': 'ADDRESS',
//   'location': 'ADDRESS',
//   'email': 'EMAIL',
//   'phone number': 'PHONE',
//   'date': 'DATE',
//   'capital social': 'CAPITAL',
//   'credit card number': 'CREDIT_CARD',
//   'social security number': 'SSN',
//   'bank account': 'BANK_ACCOUNT',
//   'iban': 'IBAN',
//   'entreprise': 'ORGANIZATION',
//   'société': 'ORGANIZATION',
//   'localisation': 'ADDRESS',
//   'adresse': 'ADDRESS',

// }

export interface GlinerResult {
  label: EntityLabel
  text: string
  start: number
  end: number
  score: number
}

/**
 * Strip markdown formatting that can confuse the NER model
 */
function stripMarkdown(text: string): string {
  return text
    // Remove bold/italic markers (handle nested cases)
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/__/g, '')
    // Remove headers (# ## ### etc) - anywhere in text
    .replace(/#{1,6}\s*/g, '')
    // Remove horizontal rules
    .replace(/---+/g, ' ')
    .replace(/\*\*\*+/g, ' ')
    // Remove bullet point markers
    .replace(/^[-*+]\s+/gm, '')
    // Remove colons that separate labels from values (common in forms)
    // Keep the content on both sides
    .replace(/\s*:\s*/g, ' ')
    // Clean up extra whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Function to remove punctuation that can confuse the NER model
 * DISABLED: Keeping punctuation actually helps the model understand context
 */
// function removePunctuation(text: string): string {
//   return text
//     .replace(/[.,;:!?'"()\[\]]«»/g, '')
//     .trim()
// }

/** Chars we treat as punctuation/space when matching (same idea as removePunctuation + separators) */
const PUNCT_OR_SPACE = /[.,;:!?'"()\[\]«»\s\-–—]/

/** Normalize for fuzzy match: remove punctuation, collapse spaces, lowercase */
function normalizeForMatch(s: string): string {
  return s
    .replace(/[.,;:!?'"()\[\]«»\s\-–—]+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Find a span in originalText that matches entityText when normalized
 * (handles punctuation/whitespace differences after model cleaning).
 * Returns { start, end, text } in original text, or null if no match.
 */
function findNormalizedMatch(originalText: string, entityText: string): { start: number; end: number; text: string } | null {
  const normalizedEntity = normalizeForMatch(entityText)
  if (normalizedEntity.length === 0) return null

  let i = 0
  while (i < originalText.length) {
    let o = i
    let e = 0
    let start = -1

    while (o < originalText.length && e < normalizedEntity.length) {
      const co = originalText[o]
      if (normalizedEntity[e] === ' ') {
        e++
        while (o < originalText.length && PUNCT_OR_SPACE.test(originalText[o])) o++
        continue
      }
      if (PUNCT_OR_SPACE.test(co)) {
        o++
        continue
      }
      if (start === -1) start = o
      if (co.toLowerCase() !== normalizedEntity[e]) break
      o++
      e++
    }
    // Skip trailing spaces in normalizedEntity
    while (e < normalizedEntity.length && normalizedEntity[e] === ' ') e++

    if (e === normalizedEntity.length) {
      const end = o
      return { start: start!, end, text: originalText.slice(start!, end) }
    }
    i++
  }
  return null
}

export class GlinerModel {
  private gliner: Gliner | null = null
  private modelLoaded = false
  private loading = false

  async load(
    onProgress?: (progress: number) => void
  ): Promise<void> {
    if (this.modelLoaded || this.loading) return
    this.loading = true

    try {
      onProgress?.(5)

      // Initialize GLiNER with the model
      // Note: wasmPaths defaults to CDN (https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/)
      this.gliner = new Gliner({
        tokenizerPath: MODEL_ID,
        onnxSettings: {
          modelPath: ONNX_MODEL_URL,   // Actual .onnx file URL (not HF ID)
          executionProvider: 'wasm',
          multiThread: false,           // Disable multi-threading for broader compatibility
        },
        maxWidth: 12,  // Fixed by ONNX model export - cannot change at runtime
      })

      onProgress?.(20)

      // Initialize the model (downloads if needed)
      await this.gliner.initialize()

      onProgress?.(100)
      this.modelLoaded = true
    } catch (error) {
      console.error('Failed to load GLiNER model:', error)
      this.modelLoaded = false
      throw error
    } finally {
      this.loading = false
    }
  }

  isLoaded(): boolean {
    return this.modelLoaded && this.gliner !== null
  }

  async predict(
    text: string,
    entities: string[] = GLINER_ENTITY_LABELS,
    threshold: number = 0.05  // 5% confidence threshold
  ): Promise<GlinerResult[]> {
    if (!this.gliner) {
      return []
    }

    const results: GlinerResult[] = []

    try {
      // Strip markdown only - keep punctuation as it provides context for the model.
      // Do NOT lowercase: casing helps the model (e.g. proper nouns / names).
      const cleanText = stripMarkdown(text)
      // const supercleanText = removePunctuation(cleanText)  // DISABLED: punctuation helps model understand context
      const predictions = await this.gliner.inference({
        texts: [cleanText],  // Use cleanText instead of supercleanText
        entities,
        threshold,
        flatNer: true,
      })

      // Process results for the first (and only) text
      if (predictions && predictions.length > 0) {
        const textPredictions = predictions[0]

        for (const pred of textPredictions) {
          const mappedLabel = LABEL_MAP[pred.label.toLowerCase()] || 'PERSON'
          const entityText = pred.spanText

          console.log(`[GLiNER] Detected: "${entityText}" (${mappedLabel}) score=${pred.score.toFixed(3)}`)

          // Map model span back to ORIGINAL text (model saw cleaned text).
          // 1) Exact match
          const originalIndex = text.indexOf(entityText)
          if (originalIndex !== -1) {
            console.log(`[GLiNER]   → Mapped via exact match at ${originalIndex}`)
            results.push({
              label: mappedLabel,
              text: entityText,
              start: originalIndex,
              end: originalIndex + entityText.length,
              score: pred.score,
            })
            continue
          }

          // 2) Case-insensitive match (preserves original casing in stored text)
          const lowerText = text.toLowerCase()
          const lowerEntity = entityText.toLowerCase()
          const lowerIndex = lowerText.indexOf(lowerEntity)
          if (lowerIndex !== -1) {
            console.log(`[GLiNER]   → Mapped via case-insensitive match at ${lowerIndex}`)
            results.push({
              label: mappedLabel,
              text: text.slice(lowerIndex, lowerIndex + entityText.length),
              start: lowerIndex,
              end: lowerIndex + entityText.length,
              score: pred.score,
            })
            continue
          }

          // 3) Normalized match (punctuation/whitespace may differ after cleaning)
          const normalized = findNormalizedMatch(text, entityText)
          if (normalized) {
            console.log(`[GLiNER]   → Mapped via normalized match at ${normalized.start}-${normalized.end}: "${normalized.text}"`)
            results.push({
              label: mappedLabel,
              text: normalized.text,
              start: normalized.start,
              end: normalized.end,
              score: pred.score,
            })
            continue
          }

          // 4) Last resort: pred.start/pred.end are in cleaned text — wrong for PDF.
          // Skip this span to avoid wrong positions downstream, or use only if no cleaning was applied.
          if (cleanText === text) {
            results.push({
              label: mappedLabel,
              text: entityText,
              start: pred.start,
              end: pred.end,
              score: pred.score,
            })
          } else {
            // Log dropped spans for debugging
            console.warn(`[GLiNER] Dropped span - could not remap to original text:`, {
              entityText,
              label: mappedLabel,
              score: pred.score,
              originalTextSnippet: text.slice(0, 200) + '...',
            })
          }
        }
      }
    } catch (error) {
      console.error('GLiNER prediction error:', error)
    }

    // Filter out false positives before returning
    const filtered = results.filter(result => {
      if (shouldExcludeSpan(result.text, result.label)) {
        console.log(`[GLiNER] Excluded false positive: "${result.text}" (${result.label})`)
        return false
      }
      return true
    })

    return filtered
  }
}

/**
 * Convert GLiNER results to DetectedSpan format
 */
export function glinerResultsToSpans(
  results: GlinerResult[],
  pageIndex: number
): Array<Omit<DetectedSpan, 'id' | 'tokens'>> {
  return results.map((result) => ({
    label: result.label,
    text: result.text,
    normalizedText: result.text.trim().toLowerCase().replace(/\s+/g, ' '),
    confidence: result.score,
    source: 'ner' as const,
    pageIndex,
    charStart: result.start,
    charEnd: result.end,
  }))
}
