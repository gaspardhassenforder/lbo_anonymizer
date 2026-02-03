import type {
  PageModel,
  DetectedSpan,
  TagEntry,
  ExportedDocument,
  ExportedPage,
} from '../types'
import { getTagForSpan, getEntitySummary, tagMapToObject } from '../tagging/tagger'

/**
 * Anonymize text by replacing spans with tags
 */
function anonymizePageText(
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
 * Export a page with anonymized content
 */
function exportPage(
  pageModel: PageModel,
  spans: DetectedSpan[],
  tagMap: Map<string, TagEntry>
): ExportedPage {
  const pageSpans = spans.filter((s) => s.pageIndex === pageModel.pageIndex)
  const anonymizedText = anonymizePageText(pageModel.text, pageSpans, tagMap)

  // Create a set of char ranges covered by spans
  const spanRanges = pageSpans.map((s) => ({
    start: s.charStart,
    end: s.charEnd,
    span: s,
  }))

  // Export tokens with anonymization info
  const exportedTokens = pageModel.tokens.map((token) => {
    // Find span that contains this token
    const containingSpan = spanRanges.find(
      (r) => token.charStart >= r.start && token.charEnd <= r.end
    )

    if (containingSpan) {
      const tag = getTagForSpan(containingSpan.span, tagMap)
      return {
        text: token.text,
        anonymizedText: tag,
        bbox: token.bbox,
        isEntity: true,
        entityLabel: containingSpan.span.label,
        tag,
      }
    }

    return {
      text: token.text,
      anonymizedText: token.text,
      bbox: token.bbox,
      isEntity: false,
    }
  })

  // Export spans
  const exportedSpans = pageSpans.map((span) => ({
    label: span.label,
    originalText: span.text,
    tag: getTagForSpan(span, tagMap),
    charStart: span.charStart,
    charEnd: span.charEnd,
  }))

  return {
    pageIndex: pageModel.pageIndex,
    originalText: pageModel.text,
    anonymizedText,
    tokens: exportedTokens,
    spans: exportedSpans,
  }
}

/**
 * Export the full document as JSON
 */
export function exportDocument(
  filename: string,
  pages: PageModel[],
  spans: DetectedSpan[],
  tagMap: Map<string, TagEntry>
): ExportedDocument {
  const exportedPages = pages.map((page) => exportPage(page, spans, tagMap))

  const entitySummary = getEntitySummary(tagMap)
  const tagMapObject = tagMapToObject(tagMap)

  return {
    filename,
    exportedAt: new Date().toISOString(),
    pageCount: pages.length,
    pages: exportedPages,
    tagMap: tagMapObject,
    entitySummary,
  }
}

/**
 * Download JSON export as file
 */
export function downloadJson(document: ExportedDocument): void {
  const json = JSON.stringify(document, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = window.document.createElement('a')
  a.href = url
  a.download = document.filename.replace(/\.pdf$/i, '_anonymized.json')
  window.document.body.appendChild(a)
  a.click()
  window.document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Export and download JSON
 */
export function exportAndDownloadJson(
  filename: string,
  pages: PageModel[],
  spans: DetectedSpan[],
  tagMap: Map<string, TagEntry>
): void {
  const document = exportDocument(filename, pages, spans, tagMap)
  downloadJson(document)
}
