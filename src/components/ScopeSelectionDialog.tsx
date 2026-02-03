import { useTranslation } from 'react-i18next'

export type ScopeOption = 'this_instance' | 'whole_document' | 'all_documents' | 'future_documents'

interface ScopeSelectionDialogProps {
  title: string
  message: string
  entityText: string
  instanceCount: number
  hasMultipleDocuments: boolean
  /** Always show the "future documents" option even with a single document */
  alwaysShowFutureOption?: boolean
  onSelect: (scope: ScopeOption) => void
  onCancel: () => void
}

export function ScopeSelectionDialog({
  title,
  message,
  entityText,
  instanceCount,
  hasMultipleDocuments,
  alwaysShowFutureOption = false,
  onSelect,
  onCancel,
}: ScopeSelectionDialogProps) {
  const { t } = useTranslation()

  // Show the "all documents" option if there are multiple documents
  // Show the "future documents" option if alwaysShowFutureOption is true and there's only one document
  const showAllDocuments = hasMultipleDocuments
  const showFutureDocuments = alwaysShowFutureOption && !hasMultipleDocuments

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
          <p className="text-sm text-slate-500 mt-1">{message}</p>
          <p className="text-sm text-slate-600 mt-2 truncate" title={entityText}>
            "{entityText}"
          </p>
        </div>

        {/* Options */}
        <div className="p-4 space-y-2">
          {/* This instance only */}
          <button
            className="w-full px-4 py-3 text-left rounded-lg border border-slate-200 hover:border-primary-300 hover:bg-primary-50 transition-colors group"
            onClick={() => onSelect('this_instance')}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-primary-100 flex items-center justify-center transition-colors">
                <svg className="w-4 h-4 text-slate-500 group-hover:text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-slate-700 group-hover:text-primary-700">
                  {t('scope.thisInstance')}
                </p>
                <p className="text-xs text-slate-500">
                  {t('scope.thisInstanceDesc')}
                </p>
              </div>
            </div>
          </button>

          {/* Whole document */}
          {instanceCount > 1 && (
            <button
              className="w-full px-4 py-3 text-left rounded-lg border border-slate-200 hover:border-primary-300 hover:bg-primary-50 transition-colors group"
              onClick={() => onSelect('whole_document')}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-primary-100 flex items-center justify-center transition-colors">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-slate-700 group-hover:text-primary-700">
                    {t('scope.wholeDocument')}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t('scope.wholeDocumentDesc', { count: instanceCount })}
                  </p>
                </div>
              </div>
            </button>
          )}

          {/* All documents (shown when multiple documents exist) */}
          {showAllDocuments && (
            <button
              className="w-full px-4 py-3 text-left rounded-lg border border-slate-200 hover:border-primary-300 hover:bg-primary-50 transition-colors group"
              onClick={() => onSelect('all_documents')}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-primary-100 flex items-center justify-center transition-colors">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-slate-700 group-hover:text-primary-700">
                    {t('scope.allDocuments')}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t('scope.allDocumentsDesc')}
                  </p>
                </div>
              </div>
            </button>
          )}

          {/* Future documents (shown when single document but alwaysShowFutureOption is true) */}
          {showFutureDocuments && (
            <button
              className="w-full px-4 py-3 text-left rounded-lg border border-slate-200 hover:border-primary-300 hover:bg-primary-50 transition-colors group"
              onClick={() => onSelect('future_documents')}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-primary-100 flex items-center justify-center transition-colors">
                  <svg className="w-4 h-4 text-slate-500 group-hover:text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-slate-700 group-hover:text-primary-700">
                    {t('scope.futureDocuments')}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t('scope.futureDocumentsDesc')}
                  </p>
                </div>
              </div>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100">
          <button
            className="w-full py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
            onClick={onCancel}
          >
            {t('dialogs.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
