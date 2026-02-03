import type { OcrWorkerRequest, OcrWorkerResponse, Token } from '../types'

type ProgressCallback = (progress: number) => void

interface OcrResult {
  tokens: Token[]
  text: string
  pageIndex: number
}

class OcrClient {
  private worker: Worker | null = null
  private pendingResolve: ((result: OcrResult) => void) | null = null
  private pendingReject: ((error: Error) => void) | null = null
  private progressCallback: ProgressCallback | null = null
  private initialized = false

  async init(): Promise<void> {
    if (this.initialized) return

    this.worker = new Worker(
      new URL('./ocr.worker.ts', import.meta.url),
      { type: 'module' }
    )

    this.worker.onmessage = (e: MessageEvent<OcrWorkerResponse>) => {
      this.handleMessage(e.data)
    }

    this.worker.onerror = (e) => {
      if (this.pendingReject) {
        this.pendingReject(new Error(e.message))
        this.pendingResolve = null
        this.pendingReject = null
      }
    }

    await this.sendMessage({ type: 'INIT' })
    this.initialized = true
  }

  private handleMessage(response: OcrWorkerResponse): void {
    switch (response.type) {
      case 'INIT_COMPLETE':
        // Handled by sendMessage
        break

      case 'PROGRESS':
        if (this.progressCallback && response.progress !== undefined) {
          this.progressCallback(response.progress)
        }
        break

      case 'RESULT':
        if (this.pendingResolve && response.tokens && response.text !== undefined && response.pageIndex !== undefined) {
          this.pendingResolve({
            tokens: response.tokens,
            text: response.text,
            pageIndex: response.pageIndex,
          })
          this.pendingResolve = null
          this.pendingReject = null
          this.progressCallback = null
        }
        break

      case 'ERROR':
        if (this.pendingReject) {
          this.pendingReject(new Error(response.error))
          this.pendingResolve = null
          this.pendingReject = null
          this.progressCallback = null
        }
        break
    }
  }

  private sendMessage(request: OcrWorkerRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not created'))
        return
      }

      const originalResolve = this.pendingResolve
      const originalReject = this.pendingReject

      this.pendingResolve = () => resolve()
      this.pendingReject = reject

      // Restore original handlers after init
      if (request.type === 'INIT') {
        const handler = (e: MessageEvent<OcrWorkerResponse>) => {
          if (e.data.type === 'INIT_COMPLETE') {
            resolve()
            this.pendingResolve = originalResolve
            this.pendingReject = originalReject
          } else if (e.data.type === 'ERROR') {
            reject(new Error(e.data.error))
            this.pendingResolve = originalResolve
            this.pendingReject = originalReject
          }
        }
        this.worker.addEventListener('message', handler, { once: true })
      }

      this.worker.postMessage(request)
    })
  }

  async recognize(
    imageData: ImageData,
    pageIndex: number,
    pdfWidth: number,
    pdfHeight: number,
    onProgress?: ProgressCallback
  ): Promise<OcrResult> {
    if (!this.worker || !this.initialized) {
      await this.init()
    }

    this.progressCallback = onProgress || null

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve
      this.pendingReject = reject

      this.worker!.postMessage({
        type: 'RECOGNIZE',
        imageData,
        pageIndex,
        pdfWidth,
        pdfHeight,
      } satisfies OcrWorkerRequest)
    })
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      this.worker.postMessage({ type: 'TERMINATE' } satisfies OcrWorkerRequest)
      this.worker.terminate()
      this.worker = null
      this.initialized = false
    }
  }
}

// Singleton instance
export const ocrClient = new OcrClient()
