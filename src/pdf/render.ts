import type { PDFPageProxy } from 'pdfjs-dist'
import { getDevicePixelRatio } from './geometry'

export interface RenderResult {
  canvas: HTMLCanvasElement
  width: number
  height: number
  scale: number
}

/**
 * Render a PDF page to a canvas with HiDPI support
 */
export async function renderPage(
  page: PDFPageProxy,
  scale: number = 1,
  existingCanvas?: HTMLCanvasElement
): Promise<RenderResult> {
  const viewport = page.getViewport({ scale })
  const dpr = getDevicePixelRatio()

  // Create or reuse canvas
  const canvas = existingCanvas || document.createElement('canvas')
  const context = canvas.getContext('2d')!

  // Set canvas size for HiDPI
  canvas.width = Math.floor(viewport.width * dpr)
  canvas.height = Math.floor(viewport.height * dpr)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`

  // Scale context for HiDPI
  context.scale(dpr, dpr)

  // Clear canvas
  context.fillStyle = 'white'
  context.fillRect(0, 0, viewport.width, viewport.height)

  // Render PDF page
  await page.render({
    canvasContext: context,
    viewport,
  }).promise

  return {
    canvas,
    width: viewport.width,
    height: viewport.height,
    scale,
  }
}

/**
 * Render a page to an image for export
 */
export async function renderPageToImage(
  page: PDFPageProxy,
  scale: number = 2, // Higher scale for better quality
  format: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality: number = 0.85
): Promise<Blob> {
  const { canvas } = await renderPage(page, scale)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to create image blob'))
        }
      },
      format,
      quality
    )
  })
}

/**
 * Get image data from a canvas for OCR
 */
export function getCanvasImageData(
  canvas: HTMLCanvasElement
): ImageData {
  const context = canvas.getContext('2d')!
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * Cleanup canvas resources
 */
export function cleanupCanvas(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d')
  if (context) {
    // Clear the canvas
    context.clearRect(0, 0, canvas.width, canvas.height)
  }
  // Reset dimensions to free memory
  canvas.width = 0
  canvas.height = 0
}
