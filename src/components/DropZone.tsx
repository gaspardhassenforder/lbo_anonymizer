import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelLoadingProgress } from '../types'

interface DropZoneProps {
  onFileSelect: (file: File) => void
  disabled?: boolean
  modelsReady?: boolean
  modelLoadingProgress?: {
    ocr: ModelLoadingProgress
    ner: ModelLoadingProgress
  }
}

export function DropZone({ onFileSelect, disabled, modelsReady, modelLoadingProgress }: DropZoneProps) {
  const { t } = useTranslation()
  const [isDragOver, setIsDragOver] = useState(false)

  // Calculate overall loading progress
  const isLoadingModels = modelLoadingProgress &&
    (modelLoadingProgress.ocr.loading || modelLoadingProgress.ner.loading)
  const overallProgress = modelLoadingProgress
    ? (modelLoadingProgress.ocr.progress + modelLoadingProgress.ner.progress) / 2
    : 0

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) {
      setIsDragOver(true)
    }
  }, [disabled])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (disabled) return

    const files = e.dataTransfer.files
    if (files.length > 0) {
      const file = files[0]
      if (file.type === 'application/pdf') {
        onFileSelect(file)
      }
    }
  }, [disabled, onFileSelect])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      onFileSelect(files[0])
    }
  }, [onFileSelect])

  return (
    <div
      className={`
        relative flex flex-col items-center justify-center
        w-full max-w-xl mx-auto
        p-16 rounded-2xl
        transition-all duration-200 ease-out cursor-pointer
        bg-white border-2 border-dashed
        ${isDragOver
          ? 'border-primary-500 bg-primary-50 shadow-lg'
          : 'border-slate-300 hover:border-primary-400 hover:bg-slate-50'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !disabled && document.getElementById('file-input')?.click()}
    >
      <input
        id="file-input"
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={handleFileInput}
        disabled={disabled}
      />

      {/* Icon */}
      <div className={`
        mb-6 p-4 rounded-xl
        ${isDragOver ? 'bg-primary-100' : 'bg-slate-100'}
        transition-all duration-200
      `}>
        <svg
          className={`w-12 h-12 transition-all duration-200 ${isDragOver ? 'text-primary-600' : 'text-slate-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
      </div>

      {/* Text content */}
      <p className={`
        text-xl font-semibold mb-2 transition-colors duration-200
        ${isDragOver ? 'text-primary-700' : 'text-slate-700'}
      `}>
        {isDragOver ? t('dropzone.titleDragOver') : t('dropzone.title')}
      </p>

      <p className="text-slate-500 mb-6">
        {t('dropzone.browse')}
      </p>

      {/* Privacy badge */}
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
        <svg className="w-4 h-4 text-success-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <span className="text-sm text-slate-600 font-medium">
          {t('dropzone.privacyBadge')}
        </span>
      </div>

      {/* Model loading status */}
      {modelLoadingProgress && (
        <div className="mt-4 w-full max-w-xs">
          {isLoadingModels ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-slate-300 border-t-primary-500" />
                <span>{t('dropzone.loadingModels')}</span>
              </div>
              <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 transition-all duration-300"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            </div>
          ) : modelsReady ? (
            <div className="flex items-center justify-center gap-2 text-sm text-success-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{t('dropzone.modelsReady')}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
