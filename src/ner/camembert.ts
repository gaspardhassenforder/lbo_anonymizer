/**
 * CamemBERT-NER based entity detection using Transformers.js
 * This is a French-specific NER model that works better for French text
 * than GLiNER's multilingual approach.
 *
 * Uses direct model access (not pipeline) to get per-label probabilities.
 */

import type { EntityLabel, DetectedSpan } from '../types'

// Base entity types (without B-/I- prefix)
type BaseEntityType = 'PER' | 'ORG' | 'LOC' | 'MISC' | 'O'

// Entity type mapping from CamemBERT NER labels to our labels
const NER_TO_ENTITY_TYPE: Record<string, EntityLabel | null> = {
  'PER': 'PERSON',
  'ORG': 'ORGANIZATION',
  'LOC': 'ADDRESS',
  'MISC': null,  // Skip MISC entities
  'O': null,     // Outside - not an entity
}

// Chunking constants for long documents
// CamemBERT has 512 token limit, ~4 chars per token on average for French
const MAX_CHUNK_CHARS = 1500
const CHUNK_OVERLAP = 200

// Minimum probability threshold for entity detection
const MIN_ENTITY_PROB = 0.3

// Common French words to filter out as false positives (standalone only)
// Note: Address-related words (rue, avenue, etc.) are NOT filtered - they're handled by merging
const FALSE_POSITIVE_WORDS = new Set([
  'd', 'de', 'du', 'des', 'le', 'la', 'les', 'l', 'un', 'une',
  'et', 'ou', 'à', 'au', 'aux', 'en', 'par', 'pour', 'sur', 'sous',
  'avec', 'sans', 'entre', 'dans', 'ce', 'cette', 'ces', 'son', 'sa',
  'ses', 'leur', 'leurs', 'qui', 'que', 'dont', 'où', 'est', 'sont',
  's', 'n', 'm', 't', 'c', 'j', 'qu', 'si', 'ne', 'pas', 'plus',
  'tout', 'tous', 'toute', 'toutes', 'autre', 'autres', 'même', 'mêmes'
])

// Month names - should not be tagged as PERSON (they're part of dates)
const MONTH_NAMES = new Set([
  'janvier', 'février', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'aout', 'septembre', 'octobre', 'novembre', 'décembre', 'decembre'
])

// Check if text looks like part of a date (month name or year)
function looksLikeDatePart(text: string): boolean {
  const t = text.trim().toLowerCase()
  // Check if it's a month name
  if (MONTH_NAMES.has(t)) return true
  // Check if it's a 4-digit year (1900-2099)
  if (/^(19|20)\d{2}$/.test(t)) return true
  return false
}

// Words that commonly appear in French addresses - used to bridge gaps
const ADDRESS_BRIDGE_WORDS = new Set([
  'rue', 'avenue', 'boulevard', 'place', 'allée', 'impasse', 'chemin', 'route',
  'passage', 'cours', 'quai', 'square', 'villa', 'cité', 'résidence',
  'de', 'du', 'des', 'la', 'le', 'les', 'l', 'aux', 'au',
  'saint', 'sainte', 'st', 'ste',
  'cedex', 'bp', 'cs',
  // Street number modifiers
  'bis', 'ter', 'quater', 'a', 'b', 'c'
])

// Maximum character gap to bridge between LOC entities
const MAX_ADDRESS_GAP = 30

// Date patterns - do not absorb into address if text matches (aligns with patterns.ts DATE)
const DATE_PATTERNS = [
  /\b(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[012])[\/\-](19|20)\d{2}\b/,
  /\b(0?[1-9]|[12][0-9]|3[01])\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(19|20)\d{2}\b/i,
]

// Patterns to detect if text ENDS with a date (year is at the end)
// Used to prevent absorbing year numbers into addresses
const DATE_ENDING_PATTERNS = [
  // "décembre 2024" or "décembre 2024," at the end
  /(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(19|20)\d{2}[,\s]*$/i,
  // "15/12/2024" or "15-12-2024" at the end
  /\d{1,2}[\/\-]\d{1,2}[\/\-](19|20)\d{2}[,\s]*$/,
  // "2024" alone preceded by month name (handles "15 décembre 2024")
  /(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+\d{4}[,\s]*$/i,
]

function looksLikeDate(text: string): boolean {
  const t = text.trim()
  return DATE_PATTERNS.some(p => p.test(t))
}

function endsWithDate(text: string): boolean {
  return DATE_ENDING_PATTERNS.some(p => p.test(text))
}

export interface CamembertResult {
  label: EntityLabel
  text: string
  start: number
  end: number
  score: number
  probabilities: Record<BaseEntityType, number>  // Full probability distribution
}

// Per-token probability distribution
interface TokenProbabilities {
  word: string
  start: number
  end: number
  probs: Record<BaseEntityType, number>
  winningLabel: BaseEntityType
  winningProb: number
  isWordStart: boolean  // True if this token starts a new word (has ▁ prefix)
  bioTag: string        // Original BIO tag (B-PER, I-PER, etc.)
}

// Aggregated entity with probability info
interface AggregatedEntity {
  start: number
  end: number
  text: string
  baseType: BaseEntityType
  avgProbs: Record<BaseEntityType, number>
  maxProb: number
  tokenCount: number
}

export class CamembertModel {
  private tokenizer: any = null
  private model: any = null
  private id2label: Record<number, string> = {}
  private modelLoaded = false
  private loading = false

  async load(onProgress?: (progress: number) => void): Promise<void> {
    if (this.modelLoaded || this.loading) return
    this.loading = true

    try {
      onProgress?.(5)

      // Dynamic import of Transformers.js from CDN (avoids WASM serving issues with Vite)
      // @ts-ignore - CDN import not recognized by TypeScript
      const transformersModule = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2')
      const { AutoTokenizer, AutoModelForTokenClassification, env } = transformersModule

      // Configure for browser usage
      env.allowLocalModels = false
      env.useBrowserCache = true

      onProgress?.(10)

      const modelId = 'Xenova/camembert-ner'

      // Load tokenizer and model separately for direct access to logits
      this.tokenizer = await AutoTokenizer.from_pretrained(modelId, {
        progress_callback: (progress: { status: string; loaded?: number; total?: number }) => {
          if (progress.status === 'downloading' && progress.loaded && progress.total) {
            const pct = progress.loaded / progress.total
            onProgress?.(10 + pct * 20)
          }
        }
      })

      onProgress?.(30)

      this.model = await AutoModelForTokenClassification.from_pretrained(modelId, {
        progress_callback: (progress: { status: string; loaded?: number; total?: number }) => {
          if (progress.status === 'downloading' && progress.loaded && progress.total) {
            const pct = progress.loaded / progress.total
            onProgress?.(30 + pct * 65)
          }
        }
      })

      // Extract id2label mapping from model config
      if (this.model.config?.id2label) {
        this.id2label = this.model.config.id2label
      } else {
        // Default CamemBERT-NER labels
        this.id2label = {
          0: 'O',
          1: 'B-LOC',
          2: 'I-LOC',
          3: 'B-MISC',
          4: 'I-MISC',
          5: 'B-ORG',
          6: 'I-ORG',
          7: 'B-PER',
          8: 'I-PER'
        }
      }

      this.modelLoaded = true
      onProgress?.(100)
      console.log('[CamemBERT] Model loaded successfully')
    } catch (error) {
      console.error('[CamemBERT] Failed to load model:', error)
      this.modelLoaded = false
      throw error
    } finally {
      this.loading = false
    }
  }

  isLoaded(): boolean {
    return this.modelLoaded && this.tokenizer !== null && this.model !== null
  }

  /**
   * Apply softmax to convert logits to probabilities
   */
  private softmax(logits: number[]): number[] {
    const maxLogit = Math.max(...logits)
    const exps = logits.map(x => Math.exp(x - maxLogit))
    const sumExps = exps.reduce((a, b) => a + b, 0)
    return exps.map(x => x / sumExps)
  }

  /**
   * Get base entity type from BIO label (B-PER, I-PER -> PER)
   */
  private getBaseType(label: string): BaseEntityType {
    const base = label.replace(/^[BI]-/, '')
    if (base === 'PER' || base === 'ORG' || base === 'LOC' || base === 'MISC' || base === 'O') {
      return base
    }
    return 'O'
  }

  /**
   * Aggregate BIO-level probabilities to base entity type probabilities
   * Combines B-PER and I-PER into PER, etc.
   */
  private aggregateBIOProbs(probs: number[], id2label: Record<number, string>): Record<BaseEntityType, number> {
    const result: Record<BaseEntityType, number> = { PER: 0, ORG: 0, LOC: 0, MISC: 0, O: 0 }

    for (let i = 0; i < probs.length; i++) {
      const label = id2label[i]
      if (label) {
        const baseType = this.getBaseType(label)
        result[baseType] += probs[i]
      }
    }

    return result
  }

  /**
   * Get the winning BIO tag from logits
   */
  private getWinningBIOTag(probs: number[]): string {
    let maxIdx = 0
    let maxProb = probs[0]
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > maxProb) {
        maxProb = probs[i]
        maxIdx = i
      }
    }
    return this.id2label[maxIdx] || 'O'
  }

  /**
   * Run model forward pass and get per-token probabilities for each label
   */
  private async getTokenProbabilities(text: string): Promise<TokenProbabilities[]> {
    if (!this.tokenizer || !this.model) return []

    // Tokenize the input with text_pair=null to get proper token handling
    const inputs = await this.tokenizer(text, {
      return_tensors: 'pt',
      truncation: true,
      max_length: 512
    })

    // Run model forward pass
    const outputs = await this.model(inputs)

    // Get logits: shape [batch=1, num_tokens, num_labels]
    const logits = outputs.logits
    const logitsData = logits.data as Float32Array
    const [, numTokens, numLabels] = logits.dims

    // Get token info for position mapping
    const tokenIds = inputs.input_ids.data as BigInt64Array
    const tokens: TokenProbabilities[] = []

    // Build a list of all tokens first to understand word boundaries
    const rawTokens: Array<{
      tokenId: number
      rawText: string      // Original token text with ▁ prefix if present
      cleanText: string    // Token text without ▁ prefix
      isWordStart: boolean // Has ▁ prefix = starts a new word
      logitIndex: number   // Index in logits array
    }> = []

    for (let t = 0; t < numTokens; t++) {
      const tokenId = Number(tokenIds[t])

      // Get the raw token text (with ▁ if present)
      const rawText = this.tokenizer.decode([tokenId], { skip_special_tokens: false })

      // Skip special tokens by checking the decoded text
      // CamemBERT special tokens: <s>, </s>, <pad>, <unk>, <mask>
      if (rawText.startsWith('<') && rawText.endsWith('>')) continue
      if (rawText === '' || rawText === ' ') continue

      const isWordStart = rawText.startsWith('▁')
      const cleanText = rawText.replace(/^▁/, '').trim()

      if (!cleanText) continue

      rawTokens.push({
        tokenId,
        rawText,
        cleanText,
        isWordStart,
        logitIndex: t
      })
    }

    // Now map tokens to character positions more carefully
    // Use a sliding window approach that respects word boundaries
    let charPos = 0
    let lastMatchEnd = 0

    for (let i = 0; i < rawTokens.length; i++) {
      const rawToken = rawTokens[i]
      const t = rawToken.logitIndex

      // If this is a word start (has ▁), we need to find it after some whitespace
      // If not a word start, it continues the previous word immediately
      let searchStart = charPos

      if (rawToken.isWordStart && i > 0) {
        // This starts a new word - search from after the last token
        // Allow for whitespace between words
        searchStart = lastMatchEnd
      }

      // Find the token in the original text
      // For subword tokens (not word start), search from exactly where we left off
      let tokenStart = -1
      const searchText = text.toLowerCase()
      const searchToken = rawToken.cleanText.toLowerCase()

      // Try exact position first for continuation tokens
      if (!rawToken.isWordStart && lastMatchEnd < text.length) {
        // Check if the text at lastMatchEnd matches
        const candidateText = searchText.slice(lastMatchEnd, lastMatchEnd + searchToken.length)
        if (candidateText === searchToken) {
          tokenStart = lastMatchEnd
        }
      }

      // If not found, search forward
      if (tokenStart === -1) {
        tokenStart = searchText.indexOf(searchToken, searchStart)
      }

      // If still not found, try from a bit before (tokenizer might have slight differences)
      if (tokenStart === -1 && searchStart > 0) {
        tokenStart = searchText.indexOf(searchToken, Math.max(0, searchStart - 5))
      }

      if (tokenStart === -1) {
        continue
      }

      const tokenEnd = tokenStart + rawToken.cleanText.length
      charPos = tokenEnd
      lastMatchEnd = tokenEnd

      // Extract logits for this token
      const tokenLogits: number[] = []
      for (let l = 0; l < numLabels; l++) {
        tokenLogits.push(logitsData[t * numLabels + l])
      }

      // Apply softmax to get probabilities
      const probs = this.softmax(tokenLogits)

      // Get the winning BIO tag (B-PER, I-PER, etc.)
      const bioTag = this.getWinningBIOTag(probs)

      // Aggregate BIO labels to base types
      const baseProbs = this.aggregateBIOProbs(probs, this.id2label)

      // Find the BEST non-O label (don't compare against O here!)
      // We'll apply thresholds later in aggregation
      let bestEntityLabel: BaseEntityType = 'O'
      let bestEntityProb = 0

      for (const [label, prob] of Object.entries(baseProbs)) {
        if (label !== 'O' && prob > bestEntityProb) {
          bestEntityLabel = label as BaseEntityType
          bestEntityProb = prob
        }
      }

      // Determine if this token should be considered an entity
      // Use threshold of 0.05 for PER (we want to catch all potential names)
      // Use MIN_ENTITY_PROB for others
      const threshold = bestEntityLabel === 'PER' ? 0.05 : MIN_ENTITY_PROB
      const isEntityToken = bestEntityProb >= threshold

      // If it's an entity token, use the entity label; otherwise O
      const winningLabel = isEntityToken ? bestEntityLabel : 'O'
      const winningProb = isEntityToken ? bestEntityProb : baseProbs['O']

      tokens.push({
        word: rawToken.cleanText,
        start: tokenStart,
        end: tokenEnd,
        probs: baseProbs,
        winningLabel,
        winningProb,
        isWordStart: rawToken.isWordStart,
        bioTag
      })
    }

    return tokens
  }

  /**
   * Aggregate consecutive tokens of the same entity type
   * Uses BIO tags to properly group tokens:
   * - B-XXX starts a new entity
   * - I-XXX continues the current entity (if same type)
   * - O ends any current entity
   */
  private aggregateTokensToEntities(tokens: TokenProbabilities[], text: string): AggregatedEntity[] {
    if (tokens.length === 0) return []

    const entities: AggregatedEntity[] = []
    let currentEntity: {
      start: number
      end: number
      baseType: BaseEntityType
      probs: Record<BaseEntityType, number>[]
      tokenCount: number
    } | null = null

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      // Threshold already applied in getTokenProbabilities
      const isEntity = token.winningLabel !== 'O'

      if (!isEntity) {
        // End current entity if any
        if (currentEntity) {
          entities.push(this.finalizeEntity(currentEntity, text))
          currentEntity = null
        }
        continue
      }

      // Check BIO tag to determine if this starts a new entity or continues
      const isBTag = token.bioTag.startsWith('B-')
      const isITag = token.bioTag.startsWith('I-')

      // Determine if this token continues the current entity
      let continuesCurrent = false
      if (currentEntity && token.winningLabel === currentEntity.baseType) {
        // Same entity type - check if it's a continuation
        if (isITag) {
          // I-tag explicitly continues
          continuesCurrent = true
        } else if (!isBTag && !token.isWordStart) {
          // Subword token (no ▁ prefix) that's not explicitly B-tagged continues
          continuesCurrent = true
        } else if (token.start <= currentEntity.end + 1) {
          // Adjacent token (no gap) - check if it's part of the same word
          // Allow continuation for subword tokens even with B-tag if immediately adjacent
          if (!token.isWordStart) {
            continuesCurrent = true
          }
        }
      }

      // For PER entities specifically, be more lenient about grouping
      // Names often have multiple words (first name + last name)
      if (currentEntity &&
          currentEntity.baseType === 'PER' &&
          token.winningLabel === 'PER' &&
          token.start <= currentEntity.end + 2) {
        // Allow continuation for person names if they're very close
        // This helps with "Jean Pierre" being detected as one entity
        continuesCurrent = true
      }

      if (continuesCurrent && currentEntity) {
        // Extend current entity
        currentEntity.end = token.end
        currentEntity.probs.push(token.probs)
        currentEntity.tokenCount++
      } else {
        // Start new entity
        if (currentEntity) {
          entities.push(this.finalizeEntity(currentEntity, text))
        }
        currentEntity = {
          start: token.start,
          end: token.end,
          baseType: token.winningLabel,
          probs: [token.probs],
          tokenCount: 1
        }
      }
    }

    // Don't forget last entity
    if (currentEntity) {
      entities.push(this.finalizeEntity(currentEntity, text))
    }

    return entities
  }

  /**
   * Finalize an entity by computing average probabilities
   */
  private finalizeEntity(
    entity: { start: number; end: number; baseType: BaseEntityType; probs: Record<BaseEntityType, number>[]; tokenCount: number },
    text: string
  ): AggregatedEntity {
    // Average probabilities across tokens
    const avgProbs: Record<BaseEntityType, number> = { PER: 0, ORG: 0, LOC: 0, MISC: 0, O: 0 }
    for (const probs of entity.probs) {
      for (const [label, prob] of Object.entries(probs)) {
        avgProbs[label as BaseEntityType] += prob / entity.probs.length
      }
    }

    // Expand to word boundaries
    const expanded = this.expandToFullWord(text, entity.start, entity.end)

    return {
      start: expanded.start,
      end: expanded.end,
      text: text.slice(expanded.start, expanded.end),
      baseType: entity.baseType,
      avgProbs,
      maxProb: avgProbs[entity.baseType],
      tokenCount: entity.tokenCount
    }
  }

  /**
   * Expand entity boundaries to full word boundaries
   */
  private expandToFullWord(text: string, start: number, end: number): { start: number; end: number } {
    const boundaryChars = /[\s\.,;:!?\(\)\[\]\{\}"«»\-–—\/\\]/

    let newStart = start
    while (newStart > 0 && !boundaryChars.test(text[newStart - 1])) {
      newStart--
    }

    let newEnd = end
    while (newEnd < text.length && !boundaryChars.test(text[newEnd])) {
      newEnd++
    }

    return { start: newStart, end: newEnd }
  }

  /**
   * Filter out false positives
   */
  private filterFalsePositives(entities: AggregatedEntity[]): AggregatedEntity[] {
    return entities.filter(entity => {
      const text = entity.text.trim()

      // Filter out single characters
      if (text.length <= 1) {
        return false
      }

      // Filter out common French words
      if (FALSE_POSITIVE_WORDS.has(text.toLowerCase())) {
        return false
      }

      // Filter out pure punctuation/numbers
      if (/^[\d\s\-\.,;:!?'"()]+$/.test(text)) {
        return false
      }

      // Filter out very short words with low confidence
      if (text.length <= 2 && entity.maxProb < 0.9) {
        return false
      }

      // For PER entities: don't tag month names or years as persons
      // This prevents "Décembre" or "2024" from being tagged as PERSON
      // and allows regex date detection to work properly
      if (entity.baseType === 'PER' && looksLikeDatePart(text)) {
        return false
      }

      return true
    })
  }

  /**
   * Expand LOC entities backward to include leading numbers (street numbers)
   * "2, rue des Vergers" → expand "rue" backward to include "2,"
   * "4 bis, rue..." → expand to include "4 bis,"
   */
  private expandAddressesBackward(entities: AggregatedEntity[], text: string): AggregatedEntity[] {
    return entities.map(entity => {
      if (entity.baseType !== 'LOC') return entity

      // Look backward from entity start for numbers
      let newStart = entity.start

      // Get text before the entity (up to 30 chars)
      const lookbackStart = Math.max(0, entity.start - 30)
      const beforeText = text.slice(lookbackStart, entity.start)

      // Match patterns like:
      // - "2, " or "2 " or "123, "
      // - "4 bis, " or "12 ter, " or "7 A, "
      // The pattern: number + optional (bis/ter/quater/a/b/c) + optional punctuation/space
      const match = beforeText.match(/(\d+(?:\s*(?:bis|ter|quater|[a-c]))?[,\s]*)\s*$/i)
      if (match && !looksLikeDate(match[1]) && !endsWithDate(beforeText)) {
        // Don't absorb if the number is part of a date (e.g., "15 décembre 2024, rue...")
        const matchStart = lookbackStart + beforeText.lastIndexOf(match[1])
        newStart = matchStart
      }

      if (newStart !== entity.start) {
        return {
          ...entity,
          start: newStart,
          text: text.slice(newStart, entity.end)
        }
      }
      return entity
    })
  }

  /**
   * Merge nearby LOC entities by absorbing gaps (numbers, prepositions, address words)
   * "rue" + "Vergers" + "21340" + "La Rochepot" → single address
   */
  private mergeNearbyAddresses(entities: AggregatedEntity[], text: string): AggregatedEntity[] {
    if (entities.length === 0) return []

    // Sort by start position
    const sorted = [...entities].sort((a, b) => a.start - b.start)
    const merged: AggregatedEntity[] = []

    let i = 0
    while (i < sorted.length) {
      const current = sorted[i]

      // Only merge LOC entities
      if (current.baseType !== 'LOC') {
        merged.push(current)
        i++
        continue
      }

      // Try to merge with following LOC entities
      let mergedEntity = { ...current }
      let j = i + 1

      while (j < sorted.length) {
        const next = sorted[j]

        // Only merge with other LOC entities - if we hit a non-LOC, stop merging
        if (next.baseType !== 'LOC') {
          break
        }

        // Check gap between entities
        const gap = next.start - mergedEntity.end
        if (gap > MAX_ADDRESS_GAP) break

        // Get the text in the gap
        const gapText = text.slice(mergedEntity.end, next.start).trim().toLowerCase()

        // Check if gap contains only bridgeable content (skip if date)
        if (looksLikeDate(gapText)) break
        const gapWords = gapText.split(/[\s,]+/).filter(w => w.length > 0)
        const canBridge = gapWords.every(word => {
          // Numbers (street numbers, postal codes) - but not dates
          if (/^\d+$/.test(word)) return true
          // Address-related words
          if (ADDRESS_BRIDGE_WORDS.has(word)) return true
          // Single punctuation or empty
          if (word.length <= 1) return true
          return false
        })

        if (canBridge || gapText.length === 0) {
          // Merge the entities
          // Average the probabilities
          const avgProbs: Record<BaseEntityType, number> = { PER: 0, ORG: 0, LOC: 0, MISC: 0, O: 0 }
          const totalTokens = mergedEntity.tokenCount + next.tokenCount
          for (const label of Object.keys(avgProbs) as BaseEntityType[]) {
            avgProbs[label] = (mergedEntity.avgProbs[label] * mergedEntity.tokenCount +
                              next.avgProbs[label] * next.tokenCount) / totalTokens
          }

          mergedEntity = {
            start: mergedEntity.start,
            end: next.end,
            text: text.slice(mergedEntity.start, next.end),
            baseType: 'LOC',
            avgProbs,
            maxProb: avgProbs.LOC,
            tokenCount: totalTokens
          }

          // Mark next as consumed by jumping past it
          j++
        } else {
          // Gap contains non-bridgeable content, stop merging
          break
        }
      }

      merged.push(mergedEntity)
      i = j  // Skip all merged entities
    }

    return merged
  }

  /**
   * Merge nearby PER entities (first name + last name should be one entity)
   * Only merge if they are separated by whitespace only
   */
  private mergeNearbyPersons(entities: AggregatedEntity[], text: string): AggregatedEntity[] {
    if (entities.length === 0) return []

    // Sort by start position
    const sorted = [...entities].sort((a, b) => a.start - b.start)
    const merged: AggregatedEntity[] = []

    let i = 0
    while (i < sorted.length) {
      const current = sorted[i]

      // Only merge PER entities
      if (current.baseType !== 'PER') {
        merged.push(current)
        i++
        continue
      }

      // Try to merge with following PER entities
      let mergedEntity = { ...current }
      let j = i + 1

      while (j < sorted.length) {
        const next = sorted[j]

        // Only merge with other PER entities - if we hit a non-PER, stop merging
        if (next.baseType !== 'PER') {
          break
        }

        // Check gap between entities - should be small (whitespace only)
        const gap = next.start - mergedEntity.end
        if (gap > 5) break  // Max 5 chars gap for names (allows for " " or "  ")

        // Get the text in the gap
        const gapText = text.slice(mergedEntity.end, next.start)

        // Only merge if gap is whitespace, hyphen, or apostrophe (common in names)
        if (!/^[\s\-']*$/.test(gapText)) break

        // Merge the entities
        // Average the probabilities
        const avgProbs: Record<BaseEntityType, number> = { PER: 0, ORG: 0, LOC: 0, MISC: 0, O: 0 }
        const totalTokens = mergedEntity.tokenCount + next.tokenCount
        for (const label of Object.keys(avgProbs) as BaseEntityType[]) {
          avgProbs[label] = (mergedEntity.avgProbs[label] * mergedEntity.tokenCount +
                            next.avgProbs[label] * next.tokenCount) / totalTokens
        }

        mergedEntity = {
          start: mergedEntity.start,
          end: next.end,
          text: text.slice(mergedEntity.start, next.end),
          baseType: 'PER',
          avgProbs,
          maxProb: avgProbs.PER,
          tokenCount: totalTokens
        }

        j++
      }

      merged.push(mergedEntity)
      i = j  // Skip all merged entities
    }

    return merged
  }

  /**
   * Convert aggregated entities to CamembertResult format
   */
  private entitiesToResults(entities: AggregatedEntity[], offset: number): CamembertResult[] {
    const results: CamembertResult[] = []

    for (const entity of entities) {
      // When MISC wins, prefer best non-MISC label (PER/ORG/LOC) if high enough
      // e.g. 60% MISC + 55% ORG → show as ORGANIZATION
      let displayBaseType = entity.baseType
      if (displayBaseType === 'MISC') {
        const candidates: BaseEntityType[] = ['PER', 'ORG', 'LOC']
        let best: BaseEntityType | null = null
        let bestProb = MIN_ENTITY_PROB
        for (const c of candidates) {
          if (entity.avgProbs[c] > bestProb) {
            bestProb = entity.avgProbs[c]
            best = c
          }
        }
        displayBaseType = best ?? 'MISC'  // If no good alternative, will be skipped
      }

      const entityType = NER_TO_ENTITY_TYPE[displayBaseType]
      if (!entityType) {
        continue  // Skip MISC (when no good alt) and O
      }

      const displayScore = entity.avgProbs[displayBaseType]

      results.push({
        label: entityType,
        text: entity.text,
        start: entity.start + offset,
        end: entity.end + offset,
        score: displayScore,
        probabilities: entity.avgProbs
      })
    }

    return results
  }

  /**
   * Process a single chunk of text
   */
  private async processChunk(chunkText: string, offset: number): Promise<CamembertResult[]> {
    // Get per-token probabilities
    const tokenProbs = await this.getTokenProbabilities(chunkText)

    // Aggregate tokens into entities
    const entities = this.aggregateTokensToEntities(tokenProbs, chunkText)

    // Filter false positives
    const filtered = this.filterFalsePositives(entities)

    // Expand addresses backward to include leading numbers (e.g., "2, rue...")
    const expanded = this.expandAddressesBackward(filtered, chunkText)

    // Merge nearby address entities (absorb numbers, prepositions between LOC entities)
    const mergedAddresses = this.mergeNearbyAddresses(expanded, chunkText)

    // Merge nearby person entities (first name + last name)
    const mergedPersons = this.mergeNearbyPersons(mergedAddresses, chunkText)

    // Convert to results
    return this.entitiesToResults(mergedPersons, offset)
  }

  /**
   * Split text into overlapping chunks
   */
  private splitIntoChunks(text: string): Array<{ text: string; offset: number }> {
    if (text.length <= MAX_CHUNK_CHARS) {
      return [{ text, offset: 0 }]
    }

    const chunks: Array<{ text: string; offset: number }> = []
    let start = 0

    while (start < text.length) {
      let end = Math.min(start + MAX_CHUNK_CHARS, text.length)

      if (end < text.length) {
        let breakPoint = text.lastIndexOf('\n\n', end)
        if (breakPoint <= start + MAX_CHUNK_CHARS / 2) {
          breakPoint = text.lastIndexOf('. ', end)
        }
        if (breakPoint <= start + MAX_CHUNK_CHARS / 2) {
          breakPoint = text.lastIndexOf(' ', end)
        }
        if (breakPoint > start + MAX_CHUNK_CHARS / 2) {
          end = breakPoint + 1
        }
      }

      chunks.push({ text: text.slice(start, end), offset: start })

      if (end >= text.length) break

      const nextStart = end - CHUNK_OVERLAP
      start = Math.max(nextStart, start + 1)
    }

    return chunks
  }

  /**
   * Deduplicate entities from overlapping chunks
   */
  private deduplicateEntities(entities: CamembertResult[]): CamembertResult[] {
    if (entities.length === 0) return []

    entities.sort((a, b) => a.start - b.start)

    const deduplicated: CamembertResult[] = []
    let current = entities[0]

    for (let i = 1; i < entities.length; i++) {
      const next = entities[i]
      const overlap = current.end > next.start
      const sameText = current.text.toLowerCase() === next.text.toLowerCase()

      if (overlap || sameText) {
        if (next.score > current.score) {
          current = next
        }
      } else {
        deduplicated.push(current)
        current = next
      }
    }
    deduplicated.push(current)

    return deduplicated
  }

  /**
   * Main prediction method
   */
  async predict(text: string): Promise<CamembertResult[]> {
    if (!this.isLoaded()) {
      return []
    }

    try {
      const chunks = this.splitIntoChunks(text)
      let allEntities: CamembertResult[] = []

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const chunkEntities = await this.processChunk(chunk.text, chunk.offset)
        allEntities = allEntities.concat(chunkEntities)
      }

      const deduplicated = this.deduplicateEntities(allEntities)

      return deduplicated
    } catch (error) {
      console.error('[CamemBERT] Prediction error:', error)
      return []
    }
  }
}

/**
 * Convert CamemBERT results to DetectedSpan format
 */
export function camembertResultsToSpans(
  results: CamembertResult[],
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
