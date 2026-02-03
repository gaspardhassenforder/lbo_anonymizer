import type { BBox, Token } from '../types'

/**
 * Transform a PDF coordinate bounding box to screen coordinates
 * PDF coordinates have origin at bottom-left, screen at top-left
 */
export function pdfToScreen(
  bbox: BBox,
  pageHeight: number,
  scale: number
): BBox {
  return {
    x: bbox.x * scale,
    y: (pageHeight - bbox.y - bbox.height) * scale,
    width: bbox.width * scale,
    height: bbox.height * scale,
  }
}

/**
 * Transform screen coordinates to PDF coordinates
 */
export function screenToPdf(
  bbox: BBox,
  pageHeight: number,
  scale: number
): BBox {
  return {
    x: bbox.x / scale,
    y: pageHeight - bbox.y / scale - bbox.height / scale,
    width: bbox.width / scale,
    height: bbox.height / scale,
  }
}

/**
 * Check if a point is inside a bounding box
 */
export function pointInBBox(x: number, y: number, bbox: BBox): boolean {
  return (
    x >= bbox.x &&
    x <= bbox.x + bbox.width &&
    y >= bbox.y &&
    y <= bbox.y + bbox.height
  )
}

/**
 * Check if two bounding boxes overlap
 */
export function bboxOverlap(a: BBox, b: BBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

/**
 * Merge multiple bounding boxes into one that contains all of them
 */
export function mergeBBoxes(boxes: BBox[]): BBox {
  if (boxes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const box of boxes) {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * Calculate the device pixel ratio for HiDPI rendering
 */
export function getDevicePixelRatio(): number {
  return window.devicePixelRatio || 1
}

/**
 * Get the intersection of two bounding boxes
 */
export function bboxIntersection(a: BBox, b: BBox): BBox | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)

  if (x2 <= x || y2 <= y) {
    return null
  }

  return {
    x,
    y,
    width: x2 - x,
    height: y2 - y,
  }
}

/**
 * Calculate the area of a bounding box
 */
export function bboxArea(bbox: BBox): number {
  return bbox.width * bbox.height
}

/**
 * Calculate overlap ratio between two bboxes (intersection / union)
 */
export function bboxIoU(a: BBox, b: BBox): number {
  const intersection = bboxIntersection(a, b)
  if (!intersection) return 0

  const intersectionArea = bboxArea(intersection)
  const unionArea = bboxArea(a) + bboxArea(b) - intersectionArea

  return intersectionArea / unionArea
}

/**
 * Get the vertical center of a bounding box
 */
function getBBoxCenterY(box: BBox): number {
  return box.y + box.height / 2
}

/**
 * Group bounding boxes by line based on Y-coordinate proximity
 * Uses center-Y comparison for better accuracy with varying box heights
 * Boxes on the same line (center Y within threshold) are grouped together
 */
export function groupBBoxesByLine(boxes: BBox[], yThreshold = 10): BBox[][] {
  if (boxes.length === 0) return []

  // Sort boxes by center Y coordinate (top to bottom in PDF coords - higher Y is higher on page)
  const sortedBoxes = [...boxes].sort((a, b) => getBBoxCenterY(b) - getBBoxCenterY(a))

  const lines: BBox[][] = []
  let currentLine: BBox[] = [sortedBoxes[0]]
  let currentLineCenterY = getBBoxCenterY(sortedBoxes[0])

  for (let i = 1; i < sortedBoxes.length; i++) {
    const box = sortedBoxes[i]
    const boxCenterY = getBBoxCenterY(box)

    // Check if this box is on the same line (center Y within threshold)
    // Also check if boxes vertically overlap significantly
    const yDiff = Math.abs(boxCenterY - currentLineCenterY)
    const hasVerticalOverlap =
      box.y < (currentLineCenterY + yThreshold) &&
      (box.y + box.height) > (currentLineCenterY - yThreshold)

    if (yDiff <= yThreshold || hasVerticalOverlap) {
      currentLine.push(box)
      // Update the line's center Y to be the average of all boxes in the line
      const totalCenterY = currentLine.reduce((sum, b) => sum + getBBoxCenterY(b), 0)
      currentLineCenterY = totalCenterY / currentLine.length
    } else {
      // Start a new line
      lines.push(currentLine)
      currentLine = [box]
      currentLineCenterY = boxCenterY
    }
  }

  // Don't forget the last line
  if (currentLine.length > 0) {
    lines.push(currentLine)
  }

  // Sort boxes within each line by X (left to right)
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x)
  }

  return lines
}

/**
 * Merge bounding boxes and return one merged box per line
 * This prevents multi-line spans from creating large rectangles covering whitespace
 */
export function mergeBBoxesByLine(boxes: BBox[], yThreshold = 5): BBox[] {
  if (boxes.length === 0) return []

  // Group boxes by line
  const lines = groupBBoxesByLine(boxes, yThreshold)

  // Merge each line into a single bounding box
  return lines.map((lineBoxes) => mergeBBoxes(lineBoxes))
}

/**
 * Calculate the partial bounding box for a character range within a token.
 * This enables precise highlighting when an entity only covers part of a token.
 *
 * For example, if a token "## SOCIÉTÉ TECHNOFRANCE SAS" spans chars 23-50,
 * but the entity "TECHNOFRANCE SAS" is only chars 34-50, this function
 * calculates the bbox for just the entity portion.
 *
 * Note: Token bboxes from PDF extraction often span the entire line width,
 * not just the text width. We estimate actual text width using bbox height
 * as reference (char width ≈ 0.5 × line height for typical fonts).
 */
export function getPartialTokenBBox(
  token: Token,
  spanCharStart: number,
  spanCharEnd: number
): BBox {
  const tokenLength = token.charEnd - token.charStart
  if (tokenLength === 0) return token.bbox

  // Estimate actual text width based on character count
  // Character width is typically ~0.55x the line height for most fonts
  const estimatedCharWidth = token.bbox.height * 0.55
  const estimatedTextWidth = tokenLength * estimatedCharWidth

  // Use the smaller of token bbox width and estimated text width
  // This prevents highlights from spanning the entire line when token bbox is line-wide
  const effectiveWidth = Math.min(token.bbox.width, estimatedTextWidth)

  // Clamp span range to token boundaries
  const clampedStart = Math.max(spanCharStart, token.charStart)
  const clampedEnd = Math.min(spanCharEnd, token.charEnd)

  // Calculate character offset within token
  const charOffsetStart = clampedStart - token.charStart
  const charOffsetEnd = clampedEnd - token.charStart

  // Calculate proportional position using effective width
  const charWidth = effectiveWidth / tokenLength
  let partialX = token.bbox.x + charOffsetStart * charWidth
  let partialWidth = (charOffsetEnd - charOffsetStart) * charWidth

  // Clamp to token bbox boundaries (never exceed original token bounds)
  const tokenMaxX = token.bbox.x + token.bbox.width
  partialX = Math.max(token.bbox.x, Math.min(partialX, tokenMaxX))
  partialWidth = Math.max(0, Math.min(partialWidth, tokenMaxX - partialX))

  return {
    x: partialX,
    y: token.bbox.y,
    width: partialWidth,
    height: token.bbox.height,
  }
}
