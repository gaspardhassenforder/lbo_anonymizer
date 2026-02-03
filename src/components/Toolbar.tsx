import { useTranslation } from 'react-i18next'
import { useStore, useTemporalStore } from '../state/store'

interface ToolbarProps {
  filename: string | null
  pageCount: number
  onConfirmAnonymisation: () => void
  onToggleLanguage: () => void
  currentLanguage: string
}

export function Toolbar({
  filename,
  pageCount,
  onConfirmAnonymisation,
  onToggleLanguage,
  currentLanguage,
}: ToolbarProps) {
  const { t } = useTranslation()
  const zoom = useStore((state) => state.zoom)
  const setZoom = useStore((state) => state.setZoom)
  const temporalStore = useTemporalStore()

  const canUndo = temporalStore.getState().pastStates.length > 0
  const canRedo = temporalStore.getState().futureStates.length > 0

  const handleUndo = () => temporalStore.getState().undo()
  const handleRedo = () => temporalStore.getState().redo()

  const handleZoomIn = () => setZoom(Math.min(3, zoom + 0.25))
  const handleZoomOut = () => setZoom(Math.max(0.25, zoom - 0.25))
  const handleZoomReset = () => setZoom(1)

  return (
    <div className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shadow-sm">
      {/* File info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-danger-50 border border-danger-200">
          <svg className="w-4 h-4 text-danger-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
            <path d="M14 2v6h6" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span className="text-sm text-danger-700 font-medium">{t('toolbar.pdf')}</span>
        </div>
        <div className="min-w-0">
          <span className="text-slate-800 font-medium truncate block" title={filename || ''}>
            {filename || t('common.noFile')}
          </span>
          {pageCount > 0 && (
            <span className="text-slate-500 text-xs">
              {t('toolbar.pages', { count: pageCount })}
            </span>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="h-8 w-px bg-slate-200" />

      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          className={`
            p-2 rounded-lg transition-all duration-150
            ${canUndo
              ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              : 'text-slate-300 cursor-not-allowed'
            }
          `}
          onClick={handleUndo}
          disabled={!canUndo}
          title={t('toolbar.undo')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
        </button>
        <button
          className={`
            p-2 rounded-lg transition-all duration-150
            ${canRedo
              ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              : 'text-slate-300 cursor-not-allowed'
            }
          `}
          onClick={handleRedo}
          disabled={!canRedo}
          title={t('toolbar.redo')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
          </svg>
        </button>
      </div>

      {/* Divider */}
      <div className="h-8 w-px bg-slate-200" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
        <button
          className="p-1.5 rounded-md hover:bg-white text-slate-500 hover:text-slate-700 transition-colors"
          onClick={handleZoomOut}
          title={t('toolbar.zoomOut')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
          </svg>
        </button>
        <button
          className="px-2 py-1 text-sm text-slate-600 hover:bg-white rounded-md min-w-[56px] transition-colors"
          onClick={handleZoomReset}
          title={t('toolbar.resetZoom')}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="p-1.5 rounded-md hover:bg-white text-slate-500 hover:text-slate-700 transition-colors"
          onClick={handleZoomIn}
          title={t('toolbar.zoomIn')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
          </svg>
        </button>
      </div>

      {/* Divider */}
      <div className="h-8 w-px bg-slate-200" />

      {/* Confirm button */}
      <button
        className="
          group flex items-center gap-2 px-4 py-2 rounded-lg
          bg-success-600 hover:bg-success-700
          text-white font-medium
          shadow-sm
          transition-all duration-150
        "
        onClick={onConfirmAnonymisation}
        title={t('toolbar.confirmAnonymisation')}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-sm">{t('toolbar.confirmAnonymisation')}</span>
      </button>

      {/* Divider */}
      <div className="h-8 w-px bg-slate-200" />

      {/* Language toggle */}
      <button
        className="
          flex items-center gap-2 px-3 py-2 rounded-lg
          text-slate-500 hover:text-slate-700
          hover:bg-slate-100
          transition-all duration-150
        "
        onClick={onToggleLanguage}
        title={currentLanguage === 'fr' ? 'English' : 'Français'}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
        </svg>
        <span className="text-sm font-medium">{currentLanguage === 'fr' ? 'FR' : 'EN'}</span>
      </button>

      {/* Divider */}
      <div className="h-8 w-px bg-slate-200" />

      {/* Version display */}
      <span className="text-xs text-slate-400 font-mono">
        v{__APP_VERSION__}
      </span>
    </div>
  )
}
