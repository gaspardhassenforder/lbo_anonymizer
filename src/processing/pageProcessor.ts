import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PageModel, DetectedSpan, EntityLabel, RedactionRegion } from '../types'
import { getPdfPage } from '../pdf/pdfLoader'
import { extractPageText, findTokensInRange } from '../pdf/textExtraction'
import { renderPage, getCanvasImageData } from '../pdf/render'
import { detectSignatureAnnotationRegions } from '../pdf/signatureAnnotations'
import { ocrClient } from '../ocr/ocrClient'
import { nerClient } from '../ner/nerClient'
import { propagateEntitiesForPage } from '../ner/propagate'
import { applyUserDecisions } from '../ner/merge'
import { normalizeText } from '../tagging/normalize'

export interface PageProcessingResult {
  pageModel: PageModel
  spans: DetectedSpan[]
  regions: RedactionRegion[]
}

export interface ProcessingCallbacks {
  onPageStart?: (pageIndex: number) => void
  onOcrProgress?: (pageIndex: number, progress: number) => void
  onPageComplete?: (pageIndex: number, result: PageProcessingResult) => void
  onPageError?: (pageIndex: number, error: Error) => void
  onFirstPageReady?: () => void
  onAllPagesComplete?: (allSpans: DetectedSpan[], allPages: PageModel[]) => void
}

export interface UserDecisions {
  suppressedTexts: Set<string>
  labelOverrides: Map<string, EntityLabel>
  forcedLabels: Map<string, EntityLabel>
}

function collapseWhitespaceWithMap(raw: string): { collapsed: string; map: number[] } {
  let collapsed = ''
  const map: number[] = []
  let inWs = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    const isWs = /\s/.test(ch)
    if (isWs) {
      if (!inWs) {
        collapsed += ' '
        map.push(i)
        inWs = true
      }
      continue
    }
    inWs = false
    collapsed += ch
    map.push(i)
  }

  return { collapsed, map }
}

/**
 * Process a single page: extract text, run OCR, run NER detection.
 */
export async function processPage(
  document: PDFDocumentProxy,
  pageIndex: number,
  callbacks?: {
    onOcrProgress?: (progress: number) => void
  },
  userDecisions?: UserDecisions
): Promise<PageProcessingResult> {
  const page = await getPdfPage(document, pageIndex)

  // Tier-1 signature detection from PDF annotations (widgets/fields)
  const regions = await detectSignatureAnnotationRegions(page, pageIndex)

  // Extract initial text structure
  let pageModel = await extractPageText(page, pageIndex)

  // Render page for OCR
  const { canvas } = await renderPage(page, 2)
  const imageData = getCanvasImageData(canvas)

  // Run OCR to get accurate word-level bounding boxes
  const ocrResult = await ocrClient.recognize(
    imageData,
    pageIndex,
    pageModel.width,
    pageModel.height,
    callbacks?.onOcrProgress
  )

  pageModel = {
    ...pageModel,
    tokens: ocrResult.tokens,
    text: ocrResult.text,
    hasOcr: true,
  }

  // Run NER detection on this page
  let pageSpans = await nerClient.detect(
    pageModel.text,
    pageModel.pageIndex,
    pageModel.tokens
  )

  // Apply user decisions (suppressions and label overrides)
  if (userDecisions && (userDecisions.suppressedTexts.size > 0 || userDecisions.labelOverrides.size > 0)) {
    const originalCount = pageSpans.length
    pageSpans = applyUserDecisions(
      pageSpans.map(s => ({
        label: s.label,
        text: s.text,
        normalizedText: s.normalizedText,
        confidence: s.confidence,
        source: s.source,
        pageIndex: s.pageIndex,
        charStart: s.charStart,
        charEnd: s.charEnd,
      })),
      userDecisions.suppressedTexts,
      userDecisions.labelOverrides
    ).map((rawSpan, index) => ({
      ...rawSpan,
      id: `span-${pageIndex}-${index}-${Date.now()}`,
      tokens: pageSpans.find(s =>
        s.charStart === rawSpan.charStart &&
        s.charEnd === rawSpan.charEnd
      )?.tokens || [],
    }))

  }

  // Apply forced labels: add spans for matching text occurrences (corpus-wide rules)
  if (userDecisions?.forcedLabels && userDecisions.forcedLabels.size > 0) {
    const suppressed = userDecisions.suppressedTexts
    const forced = userDecisions.forcedLabels

    const { collapsed, map } = collapseWhitespaceWithMap(pageModel.text)
    const collapsedLower = collapsed.toLowerCase()

    for (const [forcedNormalized, label] of forced.entries()) {
      if (!forcedNormalized) continue
      if (suppressed.has(forcedNormalized)) continue

      const needle = forcedNormalized.toLowerCase()
      let searchIdx = 0
      while (true) {
        const foundIdx = collapsedLower.indexOf(needle, searchIdx)
        if (foundIdx === -1) break

        const rawStart = map[foundIdx] ?? 0
        const lastCollapsedIdx = foundIdx + needle.length - 1
        const rawLast = map[lastCollapsedIdx] ?? rawStart
        const rawEnd = Math.min(pageModel.text.length, rawLast + 1)

        const alreadyExists = pageSpans.some(
          (s) => s.pageIndex === pageIndex && s.charStart === rawStart && s.charEnd === rawEnd
        )

        if (!alreadyExists) {
          const text = pageModel.text.slice(rawStart, rawEnd)
          pageSpans.push({
            id: `forced-${pageIndex}-${rawStart}-${rawEnd}-${Date.now()}`,
            label,
            text,
            normalizedText: normalizeText(text),
            tokens: findTokensInRange(pageModel.tokens, rawStart, rawEnd),
            confidence: 1.0,
            source: 'user',
            pageIndex,
            charStart: rawStart,
            charEnd: rawEnd,
          })
        }

        searchIdx = foundIdx + 1
      }
    }
  }

  return {
    pageModel,
    spans: pageSpans,
    regions,
  }
}

/**
 * Process a single page without NER: extract text and run OCR only.
 * Used when loading existing documents where entities are already known.
 */
export async function processPageWithoutNER(
  document: PDFDocumentProxy,
  pageIndex: number,
  callbacks?: {
    onOcrProgress?: (progress: number) => void
  }
): Promise<PageModel> {
  const page = await getPdfPage(document, pageIndex)

  // Extract initial text structure
  let pageModel = await extractPageText(page, pageIndex)

  // Render page for OCR
  const { canvas } = await renderPage(page, 2)
  const imageData = getCanvasImageData(canvas)

  // Run OCR to get accurate word-level bounding boxes
  const ocrResult = await ocrClient.recognize(
    imageData,
    pageIndex,
    pageModel.width,
    pageModel.height,
    callbacks?.onOcrProgress
  )

  pageModel = {
    ...pageModel,
    tokens: ocrResult.tokens,
    text: ocrResult.text,
    hasOcr: true,
  }

  return pageModel
}

export interface ResumeOptions {
  /** Index of the first page that still needs processing (pages before this are already done). */
  startPage: number
  /** Already-processed page models to seed cross-page propagation. */
  seedPages: PageModel[]
  /** Already-detected spans to seed cross-page propagation. */
  seedSpans: DetectedSpan[]
}

/**
 * Process document progressively, page by page.
 * - Process page 0 first and call onFirstPageReady when done
 * - Then process remaining pages, calling onPageComplete for each
 * - Finally run cross-page propagation and call onAllPagesComplete
 *
 * Pass `resumeOptions` to resume from a mid-document draft (startPage > 0).
 * In that case onFirstPageReady fires immediately and processing begins at startPage.
 *
 * @param getUserDecisions - Optional function to get current user decisions (for dynamic updates)
 * @param resumeOptions    - Optional resume state from a saved draft
 */
export async function processDocumentProgressively(
  document: PDFDocumentProxy,
  numPages: number,
  callbacks: ProcessingCallbacks,
  getUserDecisions?: () => UserDecisions,
  resumeOptions?: ResumeOptions
): Promise<void> {
  const startPage = resumeOptions?.startPage ?? 0
  const allPages: PageModel[] = resumeOptions?.seedPages ? [...resumeOptions.seedPages] : []
  const allSpans: DetectedSpan[] = resumeOptions?.seedSpans ? [...resumeOptions.seedSpans] : []

  if (startPage > 0) {
    // Already-processed pages are in the store — signal first-page-ready immediately
    callbacks.onFirstPageReady?.()

    for (let i = startPage; i < numPages; i++) {
      callbacks.onPageStart?.(i)
      try {
        const latestUserDecisions = getUserDecisions?.()
        const result = await processPage(document, i, {
          onOcrProgress: (progress) => callbacks.onOcrProgress?.(i, progress),
        }, latestUserDecisions)

        allPages.push(result.pageModel)

        const propagatedToThisPage = propagateEntitiesForPage(
          allSpans,
          result.pageModel,
          latestUserDecisions?.suppressedTexts,
          latestUserDecisions?.labelOverrides
        )

        const pageSpansWithPropagation = [...result.spans, ...propagatedToThisPage]
        allSpans.push(...pageSpansWithPropagation)

        callbacks.onPageComplete?.(i, {
          pageModel: result.pageModel,
          spans: pageSpansWithPropagation,
          regions: result.regions,
        })
      } catch (error) {
        callbacks.onPageError?.(i, error instanceof Error ? error : new Error(String(error)))
      }
    }

    callbacks.onAllPagesComplete?.(allSpans, allPages)
    return
  }

  // Process page 0 first
  callbacks.onPageStart?.(0)

  try {
    // Get latest user decisions
    const userDecisions = getUserDecisions?.()

    const firstResult = await processPage(document, 0, {
      onOcrProgress: (progress) => callbacks.onOcrProgress?.(0, progress),
    }, userDecisions)

    allPages.push(firstResult.pageModel)
    allSpans.push(...firstResult.spans)

    callbacks.onPageComplete?.(0, firstResult)

    // Signal that first page is ready - UI can now show it
    callbacks.onFirstPageReady?.()

    // Process remaining pages
    for (let i = 1; i < numPages; i++) {
      callbacks.onPageStart?.(i)

      try {
        // Get latest user decisions (may have changed during processing)
        const latestUserDecisions = getUserDecisions?.()

        const result = await processPage(document, i, {
          onOcrProgress: (progress) => callbacks.onOcrProgress?.(i, progress),
        }, latestUserDecisions)

        allPages.push(result.pageModel)

        // Propagate existing entities to this new page (respecting user decisions)
        const propagatedToThisPage = propagateEntitiesForPage(
          allSpans,
          result.pageModel,
          latestUserDecisions?.suppressedTexts,
          latestUserDecisions?.labelOverrides
        )

        // Combine detected spans with propagated ones for this page
        const pageSpansWithPropagation = [...result.spans, ...propagatedToThisPage]
        allSpans.push(...pageSpansWithPropagation)

        callbacks.onPageComplete?.(i, {
          pageModel: result.pageModel,
          spans: pageSpansWithPropagation,
          regions: result.regions,
        })
      } catch (error) {
        callbacks.onPageError?.(i, error instanceof Error ? error : new Error(String(error)))
      }
    }

    // Pass all spans and pages to the callback for final propagation
    callbacks.onAllPagesComplete?.(allSpans, allPages)
  } catch (error) {
    callbacks.onPageError?.(0, error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}
