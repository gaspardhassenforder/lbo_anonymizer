import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PageModel, DetectedSpan, TagEntry, RedactionRegion } from '../types'
import { getPdfPage } from '../pdf/pdfLoader'
import { renderPageToImage } from '../pdf/render'
import { getTagForSpan } from '../tagging/tagger'
import { mergeBBoxesByLine, mergeBBoxes } from '../pdf/geometry'

interface ExportProgress {
  stage: 'rendering' | 'building' | 'complete'
  current: number
  total: number
}

/**
 * Sanitize text for PDF embedding - remove characters that pdf-lib can't handle
 */
function sanitizeText(text: string): string {
  // Replace problematic characters with safe alternatives
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
    .replace(/[^\x20-\x7E\xA0-\xFF\u0100-\u017F]/g, '?') // Replace non-Latin chars with ?
}

/**
 * Export document as hybrid PDF with image background and positioned text layer
 */
export async function exportHybridPdf(
  pdfDocument: PDFDocumentProxy,
  pages: PageModel[],
  spans: DetectedSpan[],
  tagMap: Map<string, TagEntry>,
  onProgress?: (progress: ExportProgress) => void,
  regions: RedactionRegion[] = []
): Promise<Uint8Array> {
  // Create new PDF document
  const newPdf = await PDFDocument.create()
  const font = await newPdf.embedFont(StandardFonts.Helvetica)

  onProgress?.({ stage: 'rendering', current: 0, total: pages.length })

  for (let i = 0; i < pages.length; i++) {
    const pageModel = pages[i]
    const pdfPage = await getPdfPage(pdfDocument, pageModel.pageIndex)

    onProgress?.({ stage: 'rendering', current: i + 1, total: pages.length })

    // Render page to image
    const imageBlob = await renderPageToImage(pdfPage, 2, 'image/jpeg', 0.85)
    const imageBytes = await imageBlob.arrayBuffer()
    const image = await newPdf.embedJpg(imageBytes)

    // Create new page with same dimensions
    const newPage = newPdf.addPage([pageModel.width, pageModel.height])

    // Draw image as background
    newPage.drawImage(image, {
      x: 0,
      y: 0,
      width: pageModel.width,
      height: pageModel.height,
    })

    // Get page spans
    const pageSpans = spans.filter((s) => s.pageIndex === pageModel.pageIndex)
    const pageRegions = regions.filter((r) => r.pageIndex === pageModel.pageIndex)

    // Build a set of token IDs that are part of redacted spans
    const redactedTokenIds = new Set<string>()
    for (const span of pageSpans) {
      for (const token of span.tokens) {
        redactedTokenIds.add(token.id)
      }
    }

    // Draw black redaction rectangles over detected spans
    // Use merged bboxes for continuous redaction (e.g., "John Smith" = one rectangle)
    for (const span of pageSpans) {
      const tokenBBoxes = span.tokens.map((token) => token.bbox)
      const mergedBBoxes = mergeBBoxesByLine(tokenBBoxes, 5)

      for (const bbox of mergedBBoxes) {
        newPage.drawRectangle({
          x: bbox.x,
          y: bbox.y,  // Already in PDF coords (bottom-left origin)
          width: bbox.width,
          height: bbox.height,
          color: rgb(0, 0, 0),  // Solid black
          opacity: 1,
        })
      }
    }

    // Draw black redaction rectangles over detected regions (e.g., signature widgets)
    for (const region of pageRegions) {
      const bbox = region.bbox
      newPage.drawRectangle({
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
        color: rgb(0, 0, 0),
        opacity: 1,
      })
    }

    // Add positioned text layer for selectability/searchability
    // Layer 1: Non-redacted tokens at their original positions
    for (const token of pageModel.tokens) {
      if (redactedTokenIds.has(token.id)) continue // Skip redacted tokens

      const fontSize = Math.max(1, Math.min(token.bbox.height * 0.8, 20))
      const sanitizedText = sanitizeText(token.text)
      if (!sanitizedText.trim()) continue

      try {
        newPage.drawText(sanitizedText, {
          x: token.bbox.x,
          y: token.bbox.y + token.bbox.height * 0.15, // Adjust baseline
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          opacity: 0, // Completely invisible but selectable
        })
      } catch {
        // Skip tokens that fail (unsupported characters)
      }
    }

    // Layer 2: Anonymization tags at redaction positions
    for (const span of pageSpans) {
      const tag = getTagForSpan(span, tagMap)
      const sanitizedTag = sanitizeText(tag)

      // Get the merged bbox for the entire span
      const tokenBBoxes = span.tokens.map((token) => token.bbox)
      const mergedBBox = mergeBBoxes(tokenBBoxes)

      // Calculate font size that fits within the box
      // Estimate text width: ~0.55 * fontSize * charCount for Helvetica
      const maxFontByHeight = mergedBBox.height * 0.65
      const maxFontByWidth = (mergedBBox.width - 4) / (sanitizedTag.length * 0.55)
      const fontSize = Math.max(4, Math.min(maxFontByHeight, maxFontByWidth, 10))

      try {
        // Draw the tag as white text on black background (visible and selectable)
        newPage.drawText(sanitizedTag, {
          x: mergedBBox.x + 2,
          y: mergedBBox.y + mergedBBox.height * 0.25,
          size: fontSize,
          font,
          color: rgb(1, 1, 1), // White text on black redaction
          opacity: 1,
        })
      } catch {
        // Skip if text drawing fails
      }
    }
  }

  onProgress?.({ stage: 'building', current: pages.length, total: pages.length })

  const pdfBytes = await newPdf.save()

  onProgress?.({ stage: 'complete', current: pages.length, total: pages.length })

  return pdfBytes
}

/**
 * Download PDF export as file
 */
export function downloadPdf(pdfBytes: Uint8Array, filename: string): void {
  const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename.replace(/\.pdf$/i, '_anonymized.pdf')
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Export and download hybrid PDF
 */
export async function exportAndDownloadPdf(
  pdfDocument: PDFDocumentProxy,
  pages: PageModel[],
  spans: DetectedSpan[],
  tagMap: Map<string, TagEntry>,
  regions: RedactionRegion[] = [],
  filename: string,
  onProgress?: (progress: ExportProgress) => void
): Promise<void> {
  const pdfBytes = await exportHybridPdf(
    pdfDocument,
    pages,
    spans,
    tagMap,
    onProgress,
    regions
  )
  downloadPdf(pdfBytes, filename)
}

/**
 * Export PDF as Blob (for uploading to server)
 */
export async function exportPdfAsBlob(
  pdfDocument: PDFDocumentProxy,
  pages: PageModel[],
  spans: DetectedSpan[],
  tagMap: Map<string, TagEntry>,
  regions: RedactionRegion[] = [],
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  const pdfBytes = await exportHybridPdf(
    pdfDocument,
    pages,
    spans,
    tagMap,
    onProgress,
    regions
  )
  return new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
}
