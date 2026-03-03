import type { OcrWorkerRequest, OcrWorkerResponse, Token } from '../types'

type ProgressCallback = (progress: number) => void

interface OcrResult {
  tokens: Token[]
  text: string
  pageIndex: number
}

interface PendingOcr {
  resolve: (result: OcrResult) => void
  reject: (error: Error) => void
  progressCallback: ProgressCallback | null
}

class OcrClient {
  private worker: Worker | null = null
  private pendingByRequestId: Map<string, PendingOcr> = new Map()
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
      for (const [, pending] of this.pendingByRequestId) {
        pending.reject(new Error(e.message))
      }
      this.pendingByRequestId.clear()
    }

    await this.sendMessage({ type: 'INIT' })
    this.initialized = true
  }

  /** Reject all pending OCR requests (e.g. when switching document so stale results are not applied). */
  rejectAllPending(): void {
    for (const [, pending] of this.pendingByRequestId) {
      pending.reject(new Error('OCR cancelled (document changed)'))
    }
    this.pendingByRequestId.clear()
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

      case 'RESULT': {
        const requestId = response.requestId
        if (requestId !== undefined) {
          const pending = this.pendingByRequestId.get(requestId)
          if (pending && response.tokens && response.text !== undefined && response.pageIndex !== undefined) {
            pending.resolve({
              tokens: response.tokens,
              text: response.text,
              pageIndex: response.pageIndex,
            })
            this.pendingByRequestId.delete(requestId)
          }
        }
        break
      }

      case 'ERROR': {
        const requestId = response.requestId
        if (requestId !== undefined) {
          const pending = this.pendingByRequestId.get(requestId)
          if (pending) {
            pending.reject(new Error(response.error))
            this.pendingByRequestId.delete(requestId)
          }
        } else {
          for (const [, pending] of this.pendingByRequestId) {
            pending.reject(new Error(response.error))
          }
          this.pendingByRequestId.clear()
        }
        break
      }
    }
  }

  private sendMessage(request: OcrWorkerRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not created'))
        return
      }

      // Init does not use pendingByRequestId
      if (request.type === 'INIT') {
        const handler = (e: MessageEvent<OcrWorkerResponse>) => {
          if (e.data.type === 'INIT_COMPLETE') {
            resolve()
          } else if (e.data.type === 'INIT_ERROR' || e.data.type === 'ERROR') {
            reject(new Error(e.data.error))
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

    const requestId = `ocr_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
    return new Promise((resolve, reject) => {
      this.pendingByRequestId.set(requestId, {
        resolve,
        reject,
        progressCallback: onProgress || null,
      })
      this.progressCallback = onProgress || null

      this.worker!.postMessage({
        type: 'RECOGNIZE',
        requestId,
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
