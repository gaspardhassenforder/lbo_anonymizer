import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { PageModel, DetectedSpan, EntityLabel, PageProcessingStatus, RedactionRegion } from '../types'
import { getPdfPage } from '../pdf/pdfLoader'
import { PageView } from './PageView'
import { PageDotsNavigation } from './PageDotsNavigation'
import type { ScopeOption } from './ScopeSelectionDialog'

interface PaginatedPdfViewerProps {
  document: PDFDocumentProxy
  pages: PageModel[]
  spans: DetectedSpan[]
  regions: RedactionRegion[]
  zoom: number
  totalPageCount: number
  pageProcessingStatus: Map<number, PageProcessingStatus>
  currentPage: number
  selectedSpanId: string | null
  selectedRegionId: string | null
  hasMultipleDocuments?: boolean
  onPageChange: (pageIndex: number) => void
  onSpanClick: (span: DetectedSpan) => void
  onRegionClick: (region: RedactionRegion) => void
  onSpanRemove: (spanId: string) => void
  onSpanRemoveAllByText: (normalizedText: string) => void
  onSpanRemoveAllDocuments?: (normalizedText: string) => void
  onSpanLabelChange: (spanId: string, label: EntityLabel) => void
  onSpanLabelChangeAll: (normalizedText: string, label: EntityLabel) => void
  onSpanLabelChangeAllDocuments?: (normalizedText: string, label: EntityLabel) => void
  onSpanAdd: (pageIndex: number, charStart: number, charEnd: number, text: string, label: EntityLabel) => void
  onSpanAddAll: (pageIndex: number, charStart: number, charEnd: number, text: string, label: EntityLabel) => void
  onSpanAddAllDocuments?: (text: string, label: EntityLabel) => void
  onSpanExtend?: (spanId: string, charStart: number, charEnd: number, pageText: string, pageTokens: import('../types').Token[]) => void
  countTextMatches: (text: string) => number
  getInstanceCount: (normalizedText: string) => number
  previewAnonymized?: boolean
  selectionMode?: 'token' | 'box'
  onRegionAdd?: (pageIndex: number, bbox: import('../types').BBox, label: import('../types').EntityLabel) => void
  onRegionRemove?: (regionId: string) => void
  onRegionLabelChange?: (regionId: string, label: import('../types').EntityLabel) => void
}

export function PaginatedPdfViewer({
  document,
  pages,
  spans,
  regions,
  zoom,
  totalPageCount,
  pageProcessingStatus,
  currentPage,
  selectedSpanId,
  selectedRegionId,
  hasMultipleDocuments = false,
  onPageChange,
  onSpanClick,
  onRegionClick,
  onSpanRemove,
  onSpanRemoveAllByText,
  onSpanRemoveAllDocuments,
  onSpanLabelChange,
  onSpanLabelChangeAll,
  onSpanLabelChangeAllDocuments,
  onSpanAdd,
  onSpanAddAll,
  onSpanAddAllDocuments,
  onSpanExtend,
  countTextMatches,
  getInstanceCount,
  previewAnonymized,
  selectionMode,
  onRegionAdd,
  onRegionRemove,
  onRegionLabelChange,
}: PaginatedPdfViewerProps) {
  const { t } = useTranslation()
  // Track loaded PDF page with its index
  const [loadedPageData, setLoadedPageData] = useState<{
    pageIndex: number
    page: PDFPageProxy
  } | null>(null)
  const [, setIsLoadingPdfPage] = useState(false)

  // Load the current PDF page when currentPage changes
  useEffect(() => {
    // Skip if we already have this page loaded
    if (loadedPageData?.pageIndex === currentPage) {
      return
    }

    let isCancelled = false
    setIsLoadingPdfPage(true)

    const loadPage = async () => {
      try {
        const page = await getPdfPage(document, currentPage)
        if (!isCancelled) {
          setLoadedPageData({ pageIndex: currentPage, page })
          setIsLoadingPdfPage(false)
        }
      } catch (error) {
        console.error(`[PaginatedViewer] Failed to load PDF page ${currentPage}:`, error)
        if (!isCancelled) {
          setIsLoadingPdfPage(false)
        }
      }
    }

    loadPage()

    return () => {
      isCancelled = true
    }
  }, [document, currentPage, loadedPageData?.pageIndex])

  // Check if we have the correct page loaded
  const loadedPage = loadedPageData?.pageIndex === currentPage ? loadedPageData.page : null

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if focus is in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case 'ArrowLeft':
          if (currentPage > 0) {
            e.preventDefault()
            onPageChange(currentPage - 1)
          }
          break
        case 'ArrowRight':
          if (currentPage < totalPageCount - 1) {
            e.preventDefault()
            onPageChange(currentPage + 1)
          }
          break
        case 'Home':
          e.preventDefault()
          onPageChange(0)
          break
        case 'End':
          e.preventDefault()
          onPageChange(totalPageCount - 1)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPage, totalPageCount, onPageChange])

  // Handle span add with page context
  const handleSpanAdd = useCallback((pageIndex: number) => {
    return (charStart: number, charEnd: number, text: string, label: EntityLabel, scope: ScopeOption) => {
      switch (scope) {
        case 'this_instance':
          onSpanAdd(pageIndex, charStart, charEnd, text, label)
          break
        case 'whole_document':
          onSpanAddAll(pageIndex, charStart, charEnd, text, label)
          break
        case 'all_documents':
        case 'future_documents':
          onSpanAddAllDocuments?.(text, label)
          break
      }
    }
  }, [onSpanAdd, onSpanAddAll, onSpanAddAllDocuments])

  // Get the page model for the current page
  const pageModel = pages.find((p) => p.pageIndex === currentPage)
  const status = pageProcessingStatus.get(currentPage)

  // Render content based on page status
  const renderContent = () => {
    // Pending status - page not yet started processing
    if (status === 'pending' || status === undefined) {
      return (
        <div className="flex-1 flex items-center justify-center bg-slate-200">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-slate-500 font-medium">{t('viewer.pagePending')}</p>
            <p className="text-slate-400 text-sm mt-1">{t('common.page')} {currentPage + 1}</p>
          </div>
        </div>
      )
    }

    // Processing status - page is being processed
    if (status === 'processing') {
      return (
        <div className="flex-1 flex items-center justify-center bg-slate-200">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-warning-50 flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-warning-200 border-t-warning-500" />
            </div>
            <p className="text-slate-600 font-medium">{t('viewer.pageProcessing')}</p>
            <p className="text-slate-400 text-sm mt-1">{t('common.page')} {currentPage + 1}</p>
          </div>
        </div>
      )
    }

    // Error status
    if (status === 'error') {
      return (
        <div className="flex-1 flex items-center justify-center bg-slate-200">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-error-50 flex items-center justify-center">
              <svg className="w-6 h-6 text-error-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-error-600 font-medium">{t('viewer.pageError')}</p>
            <p className="text-slate-400 text-sm mt-1">{t('common.page')} {currentPage + 1}</p>
          </div>
        </div>
      )
    }

    // Ready status - show the page
    if (!pageModel) {
      return (
        <div className="flex-1 flex items-center justify-center bg-slate-200">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-300 border-t-primary-500" />
            <p className="text-slate-500 text-sm">{t('processing.processing')}</p>
          </div>
        </div>
      )
    }

    if (!loadedPage) {
      // PDF page still loading
      return (
        <div className="flex-1 flex items-center justify-center bg-slate-200">
          <div
            className="bg-slate-300 flex items-center justify-center rounded-sm"
            style={{
              width: pageModel.width * zoom,
              height: pageModel.height * zoom,
            }}
          >
            <div className="flex items-center gap-3 text-slate-500">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-300 border-t-primary-500" />
              <span className="text-sm font-mono">{t('common.page')} {currentPage + 1}</span>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="flex-1 overflow-auto bg-slate-200 p-6">
        <div className="flex justify-center">
          <PageView
            page={loadedPage}
            pageModel={pageModel}
            spans={spans}
            regions={regions}
            scale={zoom}
            selectedSpanId={selectedSpanId}
            selectedRegionId={selectedRegionId}
            hasMultipleDocuments={hasMultipleDocuments}
            onSpanClick={onSpanClick}
            onRegionClick={onRegionClick}
            onSpanRemove={onSpanRemove}
            onSpanRemoveAllByText={onSpanRemoveAllByText}
            onSpanRemoveAllDocuments={onSpanRemoveAllDocuments}
            onSpanLabelChange={onSpanLabelChange}
            onSpanLabelChangeAll={onSpanLabelChangeAll}
            onSpanLabelChangeAllDocuments={onSpanLabelChangeAllDocuments}
            onSpanAdd={handleSpanAdd(pageModel.pageIndex)}
            onSpanExtend={onSpanExtend}
            countTextMatches={countTextMatches}
            getInstanceCount={getInstanceCount}
            previewAnonymized={previewAnonymized}
            selectionMode={selectionMode}
            onRegionAdd={onRegionAdd}
            onRegionRemove={onRegionRemove}
            onRegionLabelChange={onRegionLabelChange}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page content area */}
      {renderContent()}

      {/* Navigation bar */}
      <PageDotsNavigation
        totalPages={totalPageCount}
        currentPage={currentPage}
        pageProcessingStatus={pageProcessingStatus}
        onPageChange={onPageChange}
      />
    </div>
  )
}
