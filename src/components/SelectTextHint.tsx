import { useTranslation } from 'react-i18next'

interface SelectTextHintProps {
  onDismiss: () => void
}

export function SelectTextHint({ onDismiss }: SelectTextHintProps) {
  const { t } = useTranslation()

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2.5 bg-primary-50 border-b border-primary-100 text-sm text-slate-700"
      role="status"
    >
      <p className="min-w-0">
        {t('editor.selectTextHint')}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="flex-shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-primary-100 transition-colors"
        aria-label={t('editor.dismiss')}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
