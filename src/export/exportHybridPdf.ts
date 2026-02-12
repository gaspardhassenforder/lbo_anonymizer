import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PageModel, DetectedSpan, TagEntry, RedactionRegion, BBox } from '../types'
import { getPdfPage } from '../pdf/pdfLoader'
import { renderPageToImage } from '../pdf/render'
import { getTagForSpan } from '../tagging/tagger'
import { mergeBBoxesByLine, bboxOverlap } from '../pdf/geometry'

const TAG_FONT_SIZE = 7
const TAG_PADDING_X = 2
const TAG_PADDING_Y = 2

interface ExportProgress {
  stage: 'rendering' | 'building' | 'complete'
  current: number
  total: number
}

interface RedactionDrawing {
  span: DetectedSpan
  sanitizedTag: string
  lineBBoxes: BBox[]
  tagTextWidth: number
  finalFirstLineBBox: BBox
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

    // === Phase A: Pre-compute RedactionDrawing[] ===
    const redactionDrawings: RedactionDrawing[] = []

    for (const span of pageSpans) {
      const tag = getTagForSpan(span, tagMap)
      const sanitizedTag = sanitizeText(tag)

      const tokenBBoxes = span.tokens.map((token) => token.bbox)
      const lineBBoxes = mergeBBoxesByLine(tokenBBoxes, 5)
      if (lineBBoxes.length === 0) continue

      // Add vertical padding to all line bboxes
      for (let j = 0; j < lineBBoxes.length; j++) {
        lineBBoxes[j] = {
          x: lineBBoxes[j].x,
          y: lineBBoxes[j].y - TAG_PADDING_Y,
          width: lineBBoxes[j].width,
          height: lineBBoxes[j].height + TAG_PADDING_Y * 2,
        }
      }

      const tagTextWidth = font.widthOfTextAtSize(sanitizedTag, TAG_FONT_SIZE)
      const firstLineBBox = { ...lineBBoxes[0] }

      // Expand first line bbox width if tag text is wider
      const neededWidth = tagTextWidth + TAG_PADDING_X * 2
      if (neededWidth > firstLineBBox.width) {
        firstLineBBox.width = neededWidth
      }

      redactionDrawings.push({
        span,
        sanitizedTag,
        lineBBoxes,
        tagTextWidth,
        finalFirstLineBBox: firstLineBBox,
      })
    }

    // === Phase B: Collision detection ===
    // Sort by first-line X coordinate (left-to-right processing)
    redactionDrawings.sort((a, b) => a.finalFirstLineBBox.x - b.finalFirstLineBBox.x)

    for (let j = 0; j < redactionDrawings.length; j++) {
      const drawing = redactionDrawings[j]
      const originalWidth = drawing.lineBBoxes[0].width
      // Only check drawings that were width-expanded
      if (drawing.finalFirstLineBBox.width <= originalWidth) continue

      const expandedBBox = drawing.finalFirstLineBBox
      const expandedCenterY = expandedBBox.y + expandedBBox.height / 2

      let maxAllowedRight = expandedBBox.x + expandedBBox.width

      // Check against non-redacted tokens to the right on the same line
      for (const token of pageModel.tokens) {
        if (redactedTokenIds.has(token.id)) continue
        const tokenBBox = token.bbox
        // Must be to the right of the original bbox
        if (tokenBBox.x < expandedBBox.x + originalWidth) continue
        // Must be on the same vertical line
        const tokenCenterY = tokenBBox.y + tokenBBox.height / 2
        if (Math.abs(tokenCenterY - expandedCenterY) > expandedBBox.height / 2) continue
        // Check overlap
        if (bboxOverlap(expandedBBox, tokenBBox)) {
          maxAllowedRight = Math.min(maxAllowedRight, tokenBBox.x - 1)
        }
      }

      // Check against other redaction drawings' first-line bboxes to the right
      for (let k = j + 1; k < redactionDrawings.length; k++) {
        const otherBBox = redactionDrawings[k].finalFirstLineBBox
        // Must be to the right
        if (otherBBox.x < expandedBBox.x + originalWidth) continue
        // Must be on the same vertical line
        const otherCenterY = otherBBox.y + otherBBox.height / 2
        if (Math.abs(otherCenterY - expandedCenterY) > expandedBBox.height / 2) continue
        // Check overlap
        if (bboxOverlap(expandedBBox, otherBBox)) {
          maxAllowedRight = Math.min(maxAllowedRight, otherBBox.x - 1)
        }
      }

      // Truncate width but never shrink below original
      const truncatedWidth = Math.max(originalWidth, maxAllowedRight - expandedBBox.x)
      drawing.finalFirstLineBBox.width = truncatedWidth
    }

    // === Phase C: Unified drawing pass ===
    for (const drawing of redactionDrawings) {
      // Draw first-line black rectangle (possibly expanded)
      newPage.drawRectangle({
        x: drawing.finalFirstLineBBox.x,
        y: drawing.finalFirstLineBBox.y,
        width: drawing.finalFirstLineBBox.width,
        height: drawing.finalFirstLineBBox.height,
        color: rgb(0, 0, 0),
        opacity: 1,
      })

      // Draw remaining-line black rectangles (vertical padding only, no width expansion)
      for (let j = 1; j < drawing.lineBBoxes.length; j++) {
        const bbox = drawing.lineBBoxes[j]
        newPage.drawRectangle({
          x: bbox.x,
          y: bbox.y,
          width: bbox.width,
          height: bbox.height,
          color: rgb(0, 0, 0),
          opacity: 1,
        })
      }

      // Draw white tag text (visible) and invisible tag text (for copy-paste/search)
      if (drawing.sanitizedTag.trim()) {
        const textX = drawing.finalFirstLineBBox.x + TAG_PADDING_X
        const textY =
          drawing.finalFirstLineBBox.y +
          drawing.finalFirstLineBBox.height / 2 -
          TAG_FONT_SIZE / 2 +
          TAG_FONT_SIZE * 0.15 // baseline adjustment

        try {
          // Visible white tag text
          newPage.drawText(drawing.sanitizedTag, {
            x: textX,
            y: textY,
            size: TAG_FONT_SIZE,
            font,
            color: rgb(1, 1, 1),
            opacity: 1,
          })

          // Invisible tag text for copy-paste and search
          newPage.drawText(drawing.sanitizedTag, {
            x: textX,
            y: textY,
            size: TAG_FONT_SIZE,
            font,
            color: rgb(0, 0, 0),
            opacity: 0,
          })
        } catch {
          // Skip if text drawing fails
        }
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
    // Non-redacted tokens at their original positions
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
