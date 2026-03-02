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

  // Focus primary button on open
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

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8.625 9.75a3.375 3.375 0 016.75 0c0 1.125-.563 2.1-1.5 2.7-.95.61-1.5 1.44-1.5 2.55v.3" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">{t('editorHelp.title')}</h2>
              <p className="text-sm text-slate-500">{t('editorHelp.subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Cards grid */}
        <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* 1 — Select */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a4 4 0 01-2.828 1.172H7v-2a4 4 0 011.172-2.828L9 13z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-800">{t('editorHelp.selectTitle')}</h3>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">{t('editorHelp.selectDesc')}</p>
          </div>

          {/* 2 — Extend */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-800">{t('editorHelp.extendTitle')}</h3>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">{t('editorHelp.extendDesc')}</p>
          </div>

          {/* 3 — Merge */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-800">{t('editorHelp.mergeTitle')}</h3>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">{t('editorHelp.mergeDesc')}</p>
          </div>

          {/* 4 — Edit / Remove */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-800">{t('editorHelp.editTitle')}</h3>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">{t('editorHelp.editDesc')}</p>
          </div>

        </div>

        {/* Scope note */}
        <div className="mx-6 mb-5 px-4 py-3 rounded-xl bg-primary-50 border border-primary-100 flex items-start gap-3">
          <svg className="w-4 h-4 text-primary-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-primary-800 leading-relaxed">{t('editorHelp.scopeNote')}</p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 select-none cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            {t('editorHelp.dontShowAgain')}
          </label>
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
  )
}
