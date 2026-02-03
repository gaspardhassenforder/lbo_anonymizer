import { useEffect, useCallback } from 'react'
import { useStore } from '../state/store'
import { ocrClient } from '../ocr/ocrClient'
import { nerClient } from '../ner/nerClient'

/**
 * Hook that loads OCR and NER models on app mount.
 * Both models are loaded in parallel for faster startup.
 */
export function useModelLoader() {
  const modelsReady = useStore((state) => state.modelsReady)
  const modelLoadingProgress = useStore((state) => state.modelLoadingProgress)
  const setModelsReady = useStore((state) => state.setModelsReady)
  const setModelLoadingProgress = useStore((state) => state.setModelLoadingProgress)

  const loadModels = useCallback(async () => {
    // Don't reload if already ready
    if (modelsReady) return

    // Start loading OCR
    setModelLoadingProgress('ocr', { loading: true, progress: 0, error: null })

    // Start loading NER
    setModelLoadingProgress('ner', { loading: true, progress: 0, error: null })

    // Load both models in parallel
    const ocrPromise = ocrClient.init()
      .then(() => {
        setModelLoadingProgress('ocr', { loading: false, progress: 100, error: null })
      })
      .catch((error) => {
        console.error('OCR model loading error:', error)
        setModelLoadingProgress('ocr', {
          loading: false,
          progress: 0,
          error: error instanceof Error ? error.message : 'Failed to load OCR model',
        })
      })

    const nerPromise = nerClient.loadModel((progress) => {
      setModelLoadingProgress('ner', { loading: true, progress, error: null })
    })
      .then(() => {
        setModelLoadingProgress('ner', { loading: false, progress: 100, error: null })
      })
      .catch((error) => {
        console.error('NER model loading error:', error)
        setModelLoadingProgress('ner', {
          loading: false,
          progress: 0,
          error: error instanceof Error ? error.message : 'Failed to load NER model',
        })
      })

    // Wait for both to complete (success or failure)
    await Promise.allSettled([ocrPromise, nerPromise])

    // Models are ready even if NER failed (we can fall back to regex)
    setModelsReady(true)
  }, [modelsReady, setModelsReady, setModelLoadingProgress])

  // Load models on mount
  useEffect(() => {
    loadModels()
  }, [loadModels])

  // Compute overall loading state
  const isLoading = modelLoadingProgress.ocr.loading || modelLoadingProgress.ner.loading
  const overallProgress = (modelLoadingProgress.ocr.progress + modelLoadingProgress.ner.progress) / 2
  const hasError = modelLoadingProgress.ocr.error !== null || modelLoadingProgress.ner.error !== null

  return {
    modelsReady,
    modelLoadingProgress,
    isLoading,
    overallProgress,
    hasError,
    reload: loadModels,
  }
}
