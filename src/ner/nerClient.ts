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
  private pendingDetections: Map<number, PendingDetection> = new Map()
  private detectionQueue: number[] = [] // Track order of requests

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
      // Reject all pending detections
      for (const [pageIndex, pending] of this.pendingDetections) {
        pending.reject(new Error('Worker error'))
        this.pendingDetections.delete(pageIndex)
      }
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
        // Still mark as loaded so we can use regex fallback
        this.modelLoaded = true
        break

      case 'DETECTION_RESULT': {
        // Get the next pending detection from the queue (FIFO order)
        const nextPageIndex = this.detectionQueue.shift()
        if (nextPageIndex !== undefined) {
          const pending = this.pendingDetections.get(nextPageIndex)
          if (pending && response.spans) {
            // Process spans: merge overlaps and attach tokens
            const processedSpans = processSpans(
              response.spans,
              pending.tokens,
              pending.pageIndex
            )
            pending.resolve(processedSpans)
            this.pendingDetections.delete(nextPageIndex)
          }
        }
        break
      }

      case 'DETECTION_ERROR':
        // Reject all pending detections on error
        for (const [pageIndex, pending] of this.pendingDetections) {
          pending.reject(new Error(response.error))
          this.pendingDetections.delete(pageIndex)
        }
        break
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

    // Ensure model is loaded
    await this.loadModel()

    return new Promise((resolve, reject) => {
      this.pendingDetections.set(pageIndex, { resolve, reject, tokens, pageIndex })
      this.detectionQueue.push(pageIndex)

      this.worker!.postMessage({
        type: 'DETECT',
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
      this.detectionQueue = []
    }
  }
}

// Singleton instance
export const nerClient = new NerClient()
