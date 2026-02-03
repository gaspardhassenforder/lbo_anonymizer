import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { PageProcessingStatus } from '../types'

interface PageDotsNavigationProps {
  totalPages: number
  currentPage: number
  pageProcessingStatus: Map<number, PageProcessingStatus>
  onPageChange: (pageIndex: number) => void
}

export function PageDotsNavigation({
  totalPages,
  currentPage,
  pageProcessingStatus,
  onPageChange,
}: PageDotsNavigationProps) {
  const { t } = useTranslation()

  // Count processed pages
  const processedCount = useMemo(() => {
    let count = 0
    for (let i = 0; i < totalPages; i++) {
      if (pageProcessingStatus.get(i) === 'ready') {
        count++
      }
    }
    return count
  }, [pageProcessingStatus, totalPages])

  const isProcessing = processedCount < totalPages

  return (
    <div className="flex items-center justify-center gap-3 py-3 px-4 bg-white border-t border-slate-200 h-14">
      {/* Previous button */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 0}
        className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title={t('viewer.previousPage')}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Page counter */}
      <div className="flex items-center gap-3 min-w-[180px] justify-center">
        <span className="text-sm font-medium text-slate-700 tabular-nums">
          {t('viewer.pageOf', { current: currentPage + 1, total: totalPages })}
        </span>

        {/* Processing status indicator */}
        <div className="flex items-center gap-1.5">
          {isProcessing ? (
            <>
              <div className="w-2 h-2 rounded-full bg-warning-400 animate-pulse" />
              <span className="text-xs text-slate-500 tabular-nums">
                {t('viewer.pagesProcessed', { count: processedCount, total: totalPages })}
              </span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-success-500" />
              <span className="text-xs text-success-600">
                {t('viewer.allProcessed')}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Next button */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages - 1}
        className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title={t('viewer.nextPage')}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  )
}
