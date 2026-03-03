import type { PDFPageProxy } from 'pdfjs-dist'
import type { BBox, RedactionRegion } from '../types'

type PdfJsAnnotation = {
  subtype?: string
  fieldType?: string
  fieldName?: string
  rect?: [number, number, number, number]
  contents?: string
  // pdf.js includes more fields; keep them available for debug logging
  [key: string]: unknown
}

function rectToBBox(rect: [number, number, number, number]): BBox {
  const [x1, y1, x2, y2] = rect
  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  const width = Math.abs(x2 - x1)
  const height = Math.abs(y2 - y1)
  return { x, y, width, height }
}

function isSignatureLikeAnnot(a: PdfJsAnnotation): boolean {
  if (!a) return false
  const subtype = (a.subtype ?? '').toLowerCase()
  const fieldType = (a.fieldType ?? '').toLowerCase()
  const fieldName = (a.fieldName ?? '').toLowerCase()
  const contents = (a.contents ?? '').toLowerCase()

  // Most reliable: widget signature fields
  if (subtype === 'widget' && fieldType === 'sig') return true

  // Sometimes vendors store helpful names/contents
  if (subtype === 'widget' && /signature|sign/i.test(fieldName)) return true
  if (/docusign|signature/i.test(contents)) return true

  return false
}

/**
 * Tier-1 signature detection: extract signature fields/widgets from PDF annotations.
 * Returns regions in PDF coordinates (bottom-left origin).
 */
export async function detectSignatureAnnotationRegions(
  page: PDFPageProxy,
  pageIndex: number
): Promise<RedactionRegion[]> {
  const annotations = (await page.getAnnotations()) as unknown as PdfJsAnnotation[]
  const regions: RedactionRegion[] = []

  for (let i = 0; i < annotations.length; i++) {
    const a = annotations[i]
    if (!a?.rect || !isSignatureLikeAnnot(a)) continue

    const bbox = rectToBBox(a.rect)
    if (bbox.width <= 0 || bbox.height <= 0) continue

    regions.push({
      id: `region-${pageIndex}-${i}-${Math.round(bbox.x)}-${Math.round(bbox.y)}-${Math.round(bbox.width)}-${Math.round(bbox.height)}`,
      pageIndex,
      bbox,
      label: 'IDENTIFIER',
      source: 'pdf-annotation',
      kind: 'signature',
    })
  }

  return regions
}

