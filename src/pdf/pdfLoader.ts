import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export interface LoadedPdf {
  document: PDFDocumentProxy
  numPages: number
}

/**
 * Load a PDF document from a File or ArrayBuffer
 */
export async function loadPdf(
  source: File | ArrayBuffer,
  onProgress?: (progress: number) => void
): Promise<LoadedPdf> {
  let data: ArrayBuffer

  if (source instanceof File) {
    data = await source.arrayBuffer()
  } else {
    // Clone the ArrayBuffer to prevent PDF.js from detaching the original
    // PDF.js transfers the ArrayBuffer to its worker, making it unusable
    data = source.slice(0)
  }

  const loadingTask = pdfjsLib.getDocument({
    data,
    cMapUrl: 'https://unpkg.com/pdfjs-dist@4.0.379/cmaps/',
    cMapPacked: true,
  })

  if (onProgress) {
    loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (total > 0) {
        onProgress(Math.round((loaded / total) * 100))
      }
    }
  }

  const document = await loadingTask.promise

  return {
    document,
    numPages: document.numPages,
  }
}

/**
 * Get a page from the loaded PDF document
 */
export async function getPdfPage(
  document: PDFDocumentProxy,
  pageIndex: number
) {
  // PDF.js uses 1-based page numbers
  return document.getPage(pageIndex + 1)
}
