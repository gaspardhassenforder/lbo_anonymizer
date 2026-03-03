import type { NerWorkerRequest, NerWorkerResponse, DetectedSpan, Token } from '../types'
import { processSpans } from './merge'

type ProgressCallback = (progress: number) => void

interface PendingDetection {
  resolve: (spans: DetectedSpan[]) => void
  reject: (error: Error) => void
  tokens: Token[]
  pageIndex: number
}

class NerClient {
  private worker: Worker | null = null
  private modelLoaded = false
  private loadingPromise: Promise<void> | null = null
  private progressCallback: ProgressCallback | null = null
  private pendingDetections: Map<string, PendingDetection> = new Map()

  private createWorker(): void {
    if (this.worker) return

    this.worker = new Worker(
      new URL('./ner.worker.ts', import.meta.url),
      { type: 'module' }
    )

    this.worker.onmessage = (e: MessageEvent<NerWorkerResponse>) => {
      this.handleMessage(e.data)
    }

    this.worker.onerror = (e) => {
      console.error('NER worker error:', e)
      for (const [, pending] of this.pendingDetections) {
        pending.reject(new Error('Worker error'))
      }
      this.pendingDetections.clear()
    }
  }

  private handleMessage(response: NerWorkerResponse): void {
    switch (response.type) {
      case 'MODEL_LOADING':
        if (this.progressCallback && response.progress !== undefined) {
          this.progressCallback(response.progress)
        }
        break

      case 'MODEL_LOADED':
        this.modelLoaded = true
        break

      case 'MODEL_ERROR':
        console.error('Model error:', response.error)
        this.modelLoaded = true
        break

      case 'DETECTION_RESULT': {
        const requestId = response.requestId
        if (requestId !== undefined) {
          const pending = this.pendingDetections.get(requestId)
          if (pending && response.spans) {
            const processedSpans = processSpans(
              response.spans,
              pending.tokens,
              pending.pageIndex
            )
            pending.resolve(processedSpans)
            this.pendingDetections.delete(requestId)
          }
        }
        break
      }

      case 'DETECTION_ERROR': {
        const requestId = response.requestId
        if (requestId !== undefined) {
          const pending = this.pendingDetections.get(requestId)
          if (pending) {
            pending.reject(new Error(response.error))
            this.pendingDetections.delete(requestId)
          }
        } else {
          for (const [, pending] of this.pendingDetections) {
            pending.reject(new Error(response.error))
          }
          this.pendingDetections.clear()
        }
        break
      }
    }
  }

  async loadModel(onProgress?: ProgressCallback): Promise<void> {
    if (this.modelLoaded) return
    if (this.loadingPromise) return this.loadingPromise

    this.createWorker()
    this.progressCallback = onProgress || null

    this.loadingPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Model loading timeout'))
      }, 60000) // 60 second timeout

      const originalHandler = this.worker!.onmessage
      this.worker!.onmessage = (e: MessageEvent<NerWorkerResponse>) => {
        if (e.data.type === 'MODEL_LOADED') {
          clearTimeout(timeout)
          this.modelLoaded = true
          this.worker!.onmessage = originalHandler
          resolve()
        } else if (e.data.type === 'MODEL_ERROR') {
          clearTimeout(timeout)
          // Don't reject - we can still use regex
          this.modelLoaded = true
          this.worker!.onmessage = originalHandler
          resolve()
        } else {
          // Handle progress messages
          this.handleMessage(e.data)
        }
      }

      this.worker!.postMessage({ type: 'LOAD_MODEL' } satisfies NerWorkerRequest)
    })

    return this.loadingPromise
  }

  async detect(
    text: string,
    pageIndex: number,
    tokens: Token[]
  ): Promise<DetectedSpan[]> {
    if (!this.worker) {
      this.createWorker()
    }

    await this.loadModel()

    const requestId = `ner_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
    return new Promise((resolve, reject) => {
      this.pendingDetections.set(requestId, { resolve, reject, tokens, pageIndex })
      this.worker!.postMessage({
        type: 'DETECT',
        requestId,
        text,
        pageIndex,
        tokens,
      } satisfies NerWorkerRequest)
    })
  }

  async detectAll(
    pages: Array<{ text: string; pageIndex: number; tokens: Token[] }>
  ): Promise<DetectedSpan[]> {
    // Load model first
    await this.loadModel()

    // Detect entities on all pages in parallel
    const results = await Promise.all(
      pages.map((page) => this.detect(page.text, page.pageIndex, page.tokens))
    )

    // Flatten results
    return results.flat()
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
      this.modelLoaded = false
      this.loadingPromise = null
      this.pendingDetections.clear()
    }
  }
}

// Singleton instance
export const nerClient = new NerClient()
