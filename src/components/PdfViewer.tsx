import { useEffect, useState, useCallback, useRef } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { PageModel, DetectedSpan, EntityLabel } from '../types'
import { getPdfPage } from '../pdf/pdfLoader'
import { PageView } from './PageView'
import type { ScopeOption } from './ScopeSelectionDialog'

interface PdfViewerProps {
  document: PDFDocumentProxy
  pages: PageModel[]
  spans: DetectedSpan[]
  zoom: number
  selectedSpanId: string | null
  onSpanClick: (span: DetectedSpan) => void
  onSpanRemove: (spanId: string) => void
  onSpanRemoveAllByText: (normalizedText: string) => void
  onSpanLabelChange: (spanId: string, label: EntityLabel) => void
  onSpanLabelChangeAll: (normalizedText: string, label: EntityLabel) => void
  onSpanAdd: (pageIndex: number, charStart: number, charEnd: number, text: string, label: EntityLabel) => void
  onSpanAddAll: (pageIndex: number, charStart: number, charEnd: number, text: string, label: EntityLabel) => void
  countTextMatches: (text: string) => number
  getInstanceCount: (normalizedText: string) => number
}

// Number of pages to render around the visible area
const RENDER_BUFFER = 2

export function PdfViewer({
  document,
  pages,
  spans,
  zoom,
  selectedSpanId,
  onSpanClick,
  onSpanRemove,
  onSpanRemoveAllByText,
  onSpanLabelChange,
  onSpanLabelChangeAll,
  onSpanAdd,
  onSpanAddAll,
  countTextMatches,
  getInstanceCount,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loadedPages, setLoadedPages] = useState<Map<number, PDFPageProxy>>(new Map())
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: RENDER_BUFFER })

  // Load pages within visible range
  useEffect(() => {
    const loadPages = async () => {
      const startIdx = Math.max(0, visibleRange.start - RENDER_BUFFER)
      const endIdx = Math.min(pages.length, visibleRange.end + RENDER_BUFFER)

      const pagesToLoad: number[] = []
      for (let i = startIdx; i < endIdx; i++) {
        if (!loadedPages.has(i)) {
          pagesToLoad.push(i)
        }
      }

      if (pagesToLoad.length === 0) return

      const newPages = new Map(loadedPages)
      for (const idx of pagesToLoad) {
        try {
          const page = await getPdfPage(document, idx)
          newPages.set(idx, page)
        } catch (error) {
          console.error(`Failed to load page ${idx}:`, error)
        }
      }

      setLoadedPages(newPages)
    }

    loadPages()
  }, [document, pages.length, visibleRange, loadedPages])

  // Update visible range on scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const scrollTop = container.scrollTop
    const containerHeight = container.clientHeight

    // Estimate page height (use first page as reference)
    const estimatedPageHeight = pages[0] ? (pages[0].height * zoom + 16) : 800

    const startPage = Math.floor(scrollTop / estimatedPageHeight)
    const visiblePages = Math.ceil(containerHeight / estimatedPageHeight)
    const endPage = startPage + visiblePages + 1

    setVisibleRange({
      start: Math.max(0, startPage),
      end: Math.min(pages.length, endPage),
    })
  }, [pages, zoom])

  // Set up scroll listener
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('scroll', handleScroll)
    handleScroll() // Initial calculation

    return () => container.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  if (pages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        No pages to display
      </div>
    )
  }

  const handleSpanAdd = useCallback((pageIndex: number) => {
    return (charStart: number, charEnd: number, text: string, label: EntityLabel, scope: ScopeOption) => {
      if (scope === 'whole_document') {
        onSpanAddAll(pageIndex, charStart, charEnd, text, label)
      } else {
        // PdfViewer doesn't support cross-document add; treat corpus scopes as instance
        onSpanAdd(pageIndex, charStart, charEnd, text, label)
      }
    }
  }, [onSpanAdd, onSpanAddAll])

  return (
    <div
      ref={containerRef}
      className="pdf-viewer h-full overflow-auto bg-slate-200 p-6"
    >
      <div className="flex flex-col items-center">
        {pages.map((pageModel) => {
          const pdfPage = loadedPages.get(pageModel.pageIndex)
          const isInRange =
            pageModel.pageIndex >= visibleRange.start - RENDER_BUFFER &&
            pageModel.pageIndex <= visibleRange.end + RENDER_BUFFER

          if (!isInRange) {
            // Placeholder for pages outside visible range
            return (
              <div
                key={pageModel.pageIndex}
                className="bg-slate-300 mb-6 rounded-sm"
                style={{
                  width: pageModel.width * zoom,
                  height: pageModel.height * zoom,
                }}
              />
            )
          }

          if (!pdfPage) {
            // Loading placeholder
            return (
              <div
                key={pageModel.pageIndex}
                className="bg-slate-200 mb-6 flex items-center justify-center rounded-sm"
                style={{
                  width: pageModel.width * zoom,
                  height: pageModel.height * zoom,
                }}
              >
                <div className="flex items-center gap-3 text-slate-500">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-300 border-t-primary-500" />
                  <span className="text-sm font-mono">Page {pageModel.pageIndex + 1}</span>
                </div>
              </div>
            )
          }

          return (
            <PageView
              key={pageModel.pageIndex}
              page={pdfPage}
              pageModel={pageModel}
              spans={spans}
              scale={zoom}
              selectedSpanId={selectedSpanId}
              onSpanClick={onSpanClick}
              onSpanRemove={onSpanRemove}
              onSpanRemoveAllByText={onSpanRemoveAllByText}
              onSpanLabelChange={onSpanLabelChange}
              onSpanLabelChangeAll={onSpanLabelChangeAll}
              onSpanAdd={handleSpanAdd(pageModel.pageIndex)}
              countTextMatches={countTextMatches}
              getInstanceCount={getInstanceCount}
            />
          )
        })}
      </div>
    </div>
  )
}
