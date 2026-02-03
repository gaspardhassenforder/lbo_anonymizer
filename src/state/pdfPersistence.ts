import { get, set, del } from 'idb-keyval'

const PDF_KEY = 'lbo-anonymizer-pdf'
const FILENAME_KEY = 'lbo-anonymizer-filename'

export interface StoredPdf {
  data: ArrayBuffer
  filename: string
}

/**
 * Store a PDF in IndexedDB for persistence across page refreshes
 */
export async function storePdf(arrayBuffer: ArrayBuffer, filename: string): Promise<void> {
  try {
    await set(PDF_KEY, arrayBuffer)
    await set(FILENAME_KEY, filename)
    console.log('[pdfPersistence] Stored PDF:', filename, arrayBuffer.byteLength, 'bytes')
  } catch (error) {
    console.error('[pdfPersistence] Failed to store PDF:', error)
    throw error
  }
}

/**
 * Load a previously stored PDF from IndexedDB
 */
export async function loadPdf(): Promise<StoredPdf | null> {
  try {
    const data = await get<ArrayBuffer>(PDF_KEY)
    const filename = await get<string>(FILENAME_KEY)

    if (data && filename) {
      console.log('[pdfPersistence] Loaded PDF:', filename, data.byteLength, 'bytes')
      return { data, filename }
    }

    return null
  } catch (error) {
    console.error('[pdfPersistence] Failed to load PDF:', error)
    return null
  }
}

/**
 * Clear stored PDF from IndexedDB
 */
export async function clearPdf(): Promise<void> {
  try {
    await del(PDF_KEY)
    await del(FILENAME_KEY)
    console.log('[pdfPersistence] Cleared stored PDF')
  } catch (error) {
    console.error('[pdfPersistence] Failed to clear PDF:', error)
    throw error
  }
}

/**
 * Convert ArrayBuffer to File object for compatibility with existing code
 */
export function arrayBufferToFile(arrayBuffer: ArrayBuffer, filename: string): File {
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' })
  return new File([blob], filename, { type: 'application/pdf' })
}
