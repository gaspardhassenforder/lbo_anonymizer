import type { PDFPageProxy } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { Token, PageModel, BBox } from '../types'

// Threshold for grouping tokens into lines (in PDF units)
const LINE_THRESHOLD = 5

interface RawTextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

/**
 * Extract text and tokens from a PDF page
 *
 * Note: PDF.js returns line-level bounding boxes which are too wide for accurate
 * word-level highlighting. This extraction is kept simple since we force OCR
 * for all pages to get accurate word-level bboxes from Tesseract.
 */
export async function extractPageText(
  page: PDFPageProxy,
  pageIndex: number
): Promise<PageModel> {
  const viewport = page.getViewport({ scale: 1 })
  const textContent = await page.getTextContent()

  const rawItems: RawTextItem[] = []

  for (const item of textContent.items) {
    // Type guard for TextItem (has 'str' property)
    if ('str' in item && item.str.trim()) {
      const textItem = item as TextItem
      rawItems.push({
        str: textItem.str,
        transform: textItem.transform,
        width: textItem.width,
        height: textItem.height,
      })
    }
  }

  // Sort by reading order: group by Y (with threshold), then sort by X
  const sortedItems = sortByReadingOrder(rawItems, viewport.height)

  // Build tokens from PDF text items (simple line-level tokens)
  // These tokens have inaccurate bboxes - OCR will replace them with word-level tokens
  const tokens: Token[] = []
  let currentOffset = 0
  let fullText = ''

  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i]
    const itemBBox = transformToBBox(item.transform, item.width, item.height)

    // Add space between items if needed
    if (i > 0 && !fullText.endsWith(' ') && !item.str.startsWith(' ')) {
      fullText += ' '
      currentOffset++
    }

    const token: Token = {
      id: `${pageIndex}-${i}`,
      text: item.str,
      bbox: itemBBox,
      pageIndex,
      charStart: currentOffset,
      charEnd: currentOffset + item.str.length,
    }

    tokens.push(token)
    fullText += item.str
    currentOffset += item.str.length
  }

  return {
    pageIndex,
    width: viewport.width,
    height: viewport.height,
    tokens,
    text: fullText,
    hasOcr: false,
  }
}

/**
 * Sort text items by reading order (top to bottom, left to right)
 */
function sortByReadingOrder(
  items: RawTextItem[],
  pageHeight: number
): RawTextItem[] {
  // Group items by approximate Y position (lines)
  const lines: Map<number, RawTextItem[]> = new Map()

  for (const item of items) {
    // Y position from transform matrix (transform[5] is vertical translation)
    const y = pageHeight - item.transform[5]

    // Find or create line group
    let lineY: number | null = null
    for (const existingY of lines.keys()) {
      if (Math.abs(y - existingY) < LINE_THRESHOLD) {
        lineY = existingY
        break
      }
    }

    if (lineY === null) {
      lineY = y
      lines.set(lineY, [])
    }

    lines.get(lineY)!.push(item)
  }

  // Sort lines by Y (descending - top first in PDF coordinates)
  const sortedLineKeys = Array.from(lines.keys()).sort((a, b) => a - b)

  // Sort items within each line by X (left to right)
  const result: RawTextItem[] = []
  for (const lineY of sortedLineKeys) {
    const lineItems = lines.get(lineY)!
    lineItems.sort((a, b) => a.transform[4] - b.transform[4])
    result.push(...lineItems)
  }

  return result
}

/**
 * Convert PDF transform matrix to bounding box
 */
function transformToBBox(
  transform: number[],
  width: number,
  height: number
): BBox {
  // Transform is [scaleX, skewY, skewX, scaleY, translateX, translateY]
  const scaleX = Math.abs(transform[0])
  const scaleY = Math.abs(transform[3])

  return {
    x: transform[4],
    y: transform[5],
    width: width * scaleX,
    height: height > 0 ? height : scaleY, // Use scaleY as height fallback
  }
}

/**
 * Check if extracted text appears to need OCR
 * Returns true if text is mostly empty or garbage
 */
export function needsOcr(pageModel: PageModel): boolean {
  const text = pageModel.text.trim()

  // No text extracted
  if (text.length < 10) {
    return true
  }

  // Check for high ratio of non-printable or special characters
  const printableChars = text.replace(/[^\x20-\x7E\u00C0-\u024F\s]/g, '')
  if (printableChars.length / text.length < 0.7) {
    return true
  }

  // Check token density - if very few tokens for a page, likely an image
  if (pageModel.tokens.length < 5) {
    return true
  }

  return false
}

/**
 * Find tokens that overlap with a character range
 */
export function findTokensInRange(
  tokens: Token[],
  charStart: number,
  charEnd: number
): Token[] {
  return tokens.filter(
    (token) => token.charEnd > charStart && token.charStart < charEnd
  )
}

/**
 * Get the merged bounding box for a character range
 */
export function getBBoxForRange(
  tokens: Token[],
  charStart: number,
  charEnd: number
): BBox | null {
  const overlappingTokens = findTokensInRange(tokens, charStart, charEnd)

  if (overlappingTokens.length === 0) {
    return null
  }

  // Merge all token bounding boxes
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const token of overlappingTokens) {
    minX = Math.min(minX, token.bbox.x)
    minY = Math.min(minY, token.bbox.y)
    maxX = Math.max(maxX, token.bbox.x + token.bbox.width)
    maxY = Math.max(maxY, token.bbox.y + token.bbox.height)
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}
