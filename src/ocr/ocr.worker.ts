import { createWorker, Worker } from 'tesseract.js'
import type { OcrWorkerRequest, OcrWorkerResponse, Token, BBox } from '../types'

let worker: Worker | null = null

async function initWorker(): Promise<void> {
  if (worker) return

  worker = await createWorker('fra+eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        self.postMessage({
          type: 'PROGRESS',
          progress: Math.round(m.progress * 100),
        } satisfies OcrWorkerResponse)
      }
    },
  })
}

async function recognize(
  requestId: string,
  imageData: ImageData,
  pageIndex: number,
  pdfWidth: number,
  pdfHeight: number
): Promise<void> {
  if (!worker) {
    throw new Error('Worker not initialized')
  }

  // Convert ImageData to canvas blob
  const canvas = new OffscreenCanvas(imageData.width, imageData.height)
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(imageData, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })

  const result = await worker.recognize(blob)

  // Convert Tesseract output to our Token format
  const tokens: Token[] = []
  let fullText = ''
  let charOffset = 0

  // Calculate scale factor: canvas pixels to PDF units
  // OCR was run on a canvas rendered at 2x scale (imageData.width = pdfWidth * 2)
  const ocrScale = imageData.width / pdfWidth

  for (const word of result.data.words) {
    // Transform from canvas pixels (top-left origin) to PDF units (bottom-left origin)
    // 1. Scale down from canvas pixels to PDF units
    // 2. Flip Y axis: PDF has origin at bottom-left, canvas at top-left
    const x = word.bbox.x0 / ocrScale
    const width = (word.bbox.x1 - word.bbox.x0) / ocrScale
    const height = (word.bbox.y1 - word.bbox.y0) / ocrScale
    // y1 is the bottom of the bbox in canvas coords (larger y = lower on page)
    // In PDF coords, y=0 is at bottom, so we need: pdfHeight - (y1 in pdf units)
    const y = pdfHeight - (word.bbox.y1 / ocrScale)

    const bbox: BBox = {
      x,
      y,
      width,
      height,
    }

    // Add space between words
    if (tokens.length > 0) {
      fullText += ' '
      charOffset++
    }

    tokens.push({
      id: `ocr-${pageIndex}-${tokens.length}`,
      text: word.text,
      bbox,
      pageIndex,
      charStart: charOffset,
      charEnd: charOffset + word.text.length,
    })

    fullText += word.text
    charOffset += word.text.length
  }

  self.postMessage({
    type: 'RESULT',
    requestId,
    tokens,
    text: fullText,
    pageIndex,
  } satisfies OcrWorkerResponse)
}

async function terminate(): Promise<void> {
  if (worker) {
    await worker.terminate()
    worker = null
  }
}

// Message handler
self.onmessage = async (e: MessageEvent<OcrWorkerRequest>) => {
  const request = e.data

  try {
    switch (request.type) {
      case 'INIT':
        await initWorker()
        self.postMessage({ type: 'INIT_COMPLETE' } satisfies OcrWorkerResponse)
        break

      case 'RECOGNIZE':
        await initWorker()
        if (request.requestId != null && request.imageData && request.pageIndex !== undefined && request.pdfWidth !== undefined && request.pdfHeight !== undefined) {
          await recognize(request.requestId, request.imageData, request.pageIndex, request.pdfWidth, request.pdfHeight)
        }
        break

      case 'TERMINATE':
        await terminate()
        break
    }
  } catch (error) {
    const requestId = e.data?.type === 'RECOGNIZE' ? (e.data as OcrWorkerRequest).requestId : undefined
    self.postMessage({
      type: 'ERROR',
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies OcrWorkerResponse)
  }
}
