import type { NerWorkerRequest, NerWorkerResponse, DetectedSpan, Token } from '../types'
import { detectWithPatterns, patternMatchesToSpans } from './patterns'
import { detectDocuSignSignatures } from './docusignSignature'

// ============================================================================
// NER MODEL CONFIGURATION
// ============================================================================
// 'camembert' - French-specific model, better for French text (default)
// 'gliner'    - Multilingual zero-shot model, flexible entity types
// 'none'      - Regex patterns only, no ML model
// ============================================================================
type NerModel = 'camembert' | 'gliner' | 'none'
const NER_MODEL: NerModel = 'camembert'
// ============================================================================

// Dynamic module references
let nerModule: any = null
let model: any = null

async function loadModel(): Promise<void> {
  if (NER_MODEL === 'none') {
    console.info('[NER Worker] Using regex patterns only (NER model disabled)')
    self.postMessage({ type: 'MODEL_LOADED' } satisfies NerWorkerResponse)
    return
  }

  if (model?.isLoaded?.()) {
    self.postMessage({ type: 'MODEL_LOADED' } satisfies NerWorkerResponse)
    return
  }

  try {
    self.postMessage({
      type: 'MODEL_LOADING',
      progress: 0,
    } satisfies NerWorkerResponse)

    if (NER_MODEL === 'camembert') {
      // Load CamemBERT-NER (French-specific)
      nerModule = await import('./camembert')
      model = new nerModule.CamembertModel()
    } else if (NER_MODEL === 'gliner') {
      // Load GLiNER (multilingual zero-shot)
      nerModule = await import('./gliner')
      model = new nerModule.GlinerModel()
    }

    await model.load((progress: number) => {
      self.postMessage({
        type: 'MODEL_LOADING',
        progress,
      } satisfies NerWorkerResponse)
    })

    self.postMessage({ type: 'MODEL_LOADED' } satisfies NerWorkerResponse)
  } catch (error) {
    console.warn(`[NER Worker] ${NER_MODEL} model not available, using regex patterns only:`, error)
    model = null
    self.postMessage({ type: 'MODEL_LOADED' } satisfies NerWorkerResponse)
  }
}

async function detect(
  text: string,
  pageIndex: number,
  tokens: Token[]
): Promise<void> {
  const spans: Array<Omit<DetectedSpan, 'id' | 'tokens'>> = []

  try {
    // Run regex pattern detection (always available)
    const regexMatches = detectWithPatterns(text, pageIndex)
    const regexSpans = patternMatchesToSpans(regexMatches, pageIndex)
    spans.push(...regexSpans)

    // Run DocuSign signature rule using token geometry
    if (tokens.length > 0) {
      const docusignSpans = detectDocuSignSignatures(tokens, pageIndex)
      spans.push(...docusignSpans)
    }

    // Run NER model if loaded
    if (model?.isLoaded?.() && nerModule) {
      try {
        const nerResults = await model.predict(text)

        // Convert results to spans using the appropriate converter
        let nerSpans: Array<Omit<DetectedSpan, 'id' | 'tokens'>>
        if (NER_MODEL === 'camembert') {
          nerSpans = nerModule.camembertResultsToSpans(nerResults, pageIndex)
        } else if (NER_MODEL === 'gliner') {
          nerSpans = nerModule.glinerResultsToSpans(nerResults, pageIndex)
        } else {
          nerSpans = []
        }

        spans.push(...nerSpans)
      } catch (nerError) {
        console.warn(`[NER Worker] ${NER_MODEL} prediction failed:`, nerError)
      }
    }

    self.postMessage({
      type: 'DETECTION_RESULT',
      spans,
    } satisfies NerWorkerResponse)
  } catch (error) {
    self.postMessage({
      type: 'DETECTION_ERROR',
      error: error instanceof Error ? error.message : 'Detection failed',
    } satisfies NerWorkerResponse)
  }
}

// Message handler
self.onmessage = async (e: MessageEvent<NerWorkerRequest>) => {
  const request = e.data

  try {
    switch (request.type) {
      case 'LOAD_MODEL':
        await loadModel()
        break

      case 'DETECT':
        if (request.text !== undefined && request.pageIndex !== undefined) {
          await detect(request.text, request.pageIndex, request.tokens ?? [])
        }
        break
    }
  } catch (error) {
    self.postMessage({
      type: 'MODEL_ERROR',
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies NerWorkerResponse)
  }
}
