import { useTranslation } from 'react-i18next'
import type { ProcessingProgress, ProcessingStage } from '../types'

interface ProcessingOverlayProps {
  progress: ProcessingProgress
}

const STAGE_ICONS: Record<ProcessingStage, JSX.Element> = {
  idle: <></>,
  'loading-pdf': (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  ),
  'extracting-text': (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
    </svg>
  ),
  'running-ocr': (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  'loading-model': (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
    </svg>
  ),
  'detecting-entities': (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    </svg>
  ),
  ready: <></>,
}

export function ProcessingOverlay({ progress }: ProcessingOverlayProps) {
  const { t } = useTranslation()

  if (progress.stage === 'idle' || progress.stage === 'ready') {
    return null
  }

  const getStageLabel = (stage: ProcessingStage): string => {
    switch (stage) {
      case 'loading-pdf':
        return t('processing.loadingPdf')
      case 'extracting-text':
        return t('processing.extractingText')
      case 'running-ocr':
        return t('processing.runningOcr')
      case 'loading-model':
        return t('processing.loadingModel')
      case 'detecting-entities':
        return t('processing.detectingEntities')
      default:
        return ''
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        {/* Content */}
        <div>
          <div className="flex items-start gap-4 mb-6">
            {/* Animated icon */}
            <div className="relative">
              <div className="w-14 h-14 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center text-primary-600">
                {STAGE_ICONS[progress.stage]}
              </div>
              {/* Pulse ring */}
              <div className="absolute inset-0 rounded-xl border-2 border-primary-400 animate-ping opacity-30" />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-slate-800 mb-1">
                {getStageLabel(progress.stage)}
              </h3>
              {progress.message && (
                <p className="text-sm text-slate-500 truncate" title={progress.message}>
                  {progress.message}
                </p>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="relative">
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all duration-300 ease-out rounded-full"
                style={{ width: `${progress.progress}%` }}
              />
            </div>

            {/* Progress text */}
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-slate-500">{t('processing.processing')}</span>
              <span className="text-sm font-medium text-primary-600">
                {progress.progress}%
              </span>
            </div>
          </div>

          {/* Status indicator */}
          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-center gap-2">
            <span className="status-dot active" />
            <span className="text-xs text-slate-500">
              {t('processing.processingLocally')}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
