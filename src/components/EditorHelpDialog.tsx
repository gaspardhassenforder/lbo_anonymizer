import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface EditorHelpDialogProps {
  isOpen: boolean
  onClose: (dontShowAgain: boolean) => void
}

export function EditorHelpDialog({ isOpen, onClose }: EditorHelpDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  // Focus first button on open
  useEffect(() => {
    if (!isOpen) return
    const dialog = dialogRef.current
    if (!dialog) return
    const btn = dialog.querySelector<HTMLButtonElement>('[data-primary]')
    btn?.focus()
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(dontShowAgain)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose, dontShowAgain])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onClose(dontShowAgain)}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden animate-scale-in border border-slate-200"
        role="dialog"
        aria-modal="true"
      >
        <div className="h-1 bg-primary-500" />

        <div className="px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8.625 9.75a3.375 3.375 0 016.75 0c0 1.125-.563 2.1-1.5 2.7-.95.61-1.5 1.44-1.5 2.55v.3" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-800">
                {t('editorHelp.title')}
              </h2>
              <p className="text-sm text-slate-500">
                {t('editorHelp.subtitle')}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5 text-slate-700">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">{t('editorHelp.selectingTitle')}</h3>
            <ul className="text-sm text-slate-600 list-disc pl-5 space-y-1">
              <li>{t('editorHelp.selectingStep1')}</li>
              <li>{t('editorHelp.selectingStep2')}</li>
              <li>{t('editorHelp.selectingStep3')}</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">{t('editorHelp.anonymizeTitle')}</h3>
            <ul className="text-sm text-slate-600 list-disc pl-5 space-y-1">
              <li>{t('editorHelp.anonymizeStep1')}</li>
              <li>{t('editorHelp.scopeStep')}</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">{t('editorHelp.deanonymizeTitle')}</h3>
            <ul className="text-sm text-slate-600 list-disc pl-5 space-y-1">
              <li>{t('editorHelp.deanonymizeStep1')}</li>
              <li>{t('editorHelp.scopeStep')}</li>
            </ul>
          </div>
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 select-none">
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            {t('editorHelp.dontShowAgain')}
          </label>

          <div className="flex items-center gap-3">
            <button
              className="px-4 py-2.5 text-sm font-medium rounded-lg text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 hover:border-slate-300 transition-all duration-150"
              onClick={() => onClose(dontShowAgain)}
            >
              {t('dialogs.confirm')}
            </button>
            <button
              data-primary
              className="px-4 py-2.5 text-sm font-medium rounded-lg bg-primary-600 hover:bg-primary-700 text-white shadow-sm transition-all duration-150"
              onClick={() => onClose(dontShowAgain)}
            >
              {t('editorHelp.gotIt')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

