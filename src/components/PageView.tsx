import { useEffect, useRef, useCallback, useState } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { PageModel, DetectedSpan, EntityLabel, RedactionRegion } from '../types'
import { cleanupCanvas } from '../pdf/render'
import { AnnotationLayer } from './AnnotationLayer'
import { RegionLayer } from './RegionLayer'
import { TextLayer } from './TextLayer'
import { TagPopover, LabelPicker } from './TagPopover'
import { normalizeText } from '../state/store'
import type { ScopeOption } from './ScopeSelectionDialog'

interface PageViewProps {
  page: PDFPageProxy
  pageModel: PageModel
  spans: DetectedSpan[]
  regions: RedactionRegion[]
  scale: number
  selectedSpanId: string | null
  selectedRegionId: string | null
  hasMultipleDocuments?: boolean
  onSpanClick: (span: DetectedSpan) => void
  onRegionClick: (region: RedactionRegion) => void
  onSpanRemove: (spanId: string) => void
  onSpanRemoveAllByText: (normalizedText: string) => void
  onSpanRemoveAllDocuments?: (normalizedText: string) => void
  onSpanLabelChange: (spanId: string, label: EntityLabel) => void
  onSpanLabelChangeAll: (normalizedText: string, label: EntityLabel) => void
  onSpanLabelChangeAllDocuments?: (normalizedText: string, label: EntityLabel) => void
  onSpanAdd: (charStart: number, charEnd: number, text: string, label: EntityLabel, scope: ScopeOption) => void
  countTextMatches: (text: string) => number
  getInstanceCount: (normalizedText: string) => number
}

export function PageView({
  page,
  pageModel,
  spans,
  regions,
  scale,
  selectedSpanId,
  selectedRegionId,
  hasMultipleDocuments = false,
  onSpanClick,
  onRegionClick,
  onSpanRemove,
  onSpanRemoveAllByText,
  onSpanRemoveAllDocuments,
  onSpanLabelChange,
  onSpanLabelChangeAll,
  onSpanLabelChangeAllDocuments,
  onSpanAdd,
  countTextMatches,
  getInstanceCount,
}: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const [isRendered, setIsRendered] = useState(false)
  const [popover, setPopover] = useState<{
    span: DetectedSpan
    anchorRect: DOMRect
  } | null>(null)
  const [labelPicker, setLabelPicker] = useState<{
    charStart: number
    charEnd: number
    text: string
    anchorRect: DOMRect
  } | null>(null)

  // Render PDF page to canvas
  useEffect(() => {
    let isCancelled = false
    const canvas = canvasRef.current
    if (!canvas) return

    // Cancel any previous render task
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel()
      renderTaskRef.current = null
    }

    const render = async () => {
      try {
        const viewport = page.getViewport({ scale })
        const dpr = window.devicePixelRatio || 1

        // Set canvas size
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        const context = canvas.getContext('2d')!
        context.scale(dpr, dpr)
        context.fillStyle = 'white'
        context.fillRect(0, 0, viewport.width, viewport.height)

        const renderTask = page.render({
          canvasContext: context,
          viewport,
        })

        renderTaskRef.current = renderTask

        await renderTask.promise

        if (!isCancelled) {
          setIsRendered(true)
        }
      } catch (error) {
        if (!isCancelled && (error as Error).name !== 'RenderingCancelledException') {
          console.error('Failed to render page:', error)
        }
      }
    }

    setIsRendered(false)
    render()

    return () => {
      isCancelled = true
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }
    }
  }, [page, scale])

  // Cleanup canvas on unmount
  useEffect(() => {
    return () => {
      if (canvasRef.current) {
        cleanupCanvas(canvasRef.current)
      }
    }
  }, [])

  // Handle span click
  const handleSpanClick = useCallback((span: DetectedSpan, event: React.MouseEvent) => {
    onSpanClick(span)

    // Get the clicked element's bounding rect for anchor positioning
    const targetRect = (event.currentTarget as HTMLElement).getBoundingClientRect()

    setPopover({
      span,
      anchorRect: targetRect,
    })
  }, [onSpanClick])

  const handleRegionClick = useCallback((region: RedactionRegion) => {
    onRegionClick(region)
  }, [onRegionClick])

  // Handle text selection for adding new span
  const handleSelectionCreate = useCallback((charStart: number, charEnd: number, text: string, anchorRect: DOMRect) => {
    setLabelPicker({
      charStart,
      charEnd,
      text,
      anchorRect,
    })
  }, [])

  // Handle label selection for new span
  const handleLabelSelect = useCallback((label: EntityLabel, scope: ScopeOption) => {
    if (!labelPicker) return
    onSpanAdd(labelPicker.charStart, labelPicker.charEnd, labelPicker.text, label, scope)
    setLabelPicker(null)
  }, [labelPicker, onSpanAdd])

  // Page dimensions
  const width = pageModel.width * scale
  const height = pageModel.height * scale

  // Filter spans for this page
  const pageSpans = spans.filter((s) => s.pageIndex === pageModel.pageIndex)
  const pageRegions = regions.filter((r) => r.pageIndex === pageModel.pageIndex)

  return (
    <div
      ref={containerRef}
      className="relative bg-white shadow-lg mb-6 rounded-sm ring-1 ring-slate-300"
      style={{ width, height }}
    >
      {/* PDF canvas */}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 ${isRendered ? '' : 'opacity-0'}`}
      />

      {/* Loading placeholder */}
      {!isRendered && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-300 border-t-primary-500" />
        </div>
      )}

      {/* Text layer for native selection (z-index: 1) */}
      {isRendered && (
        <TextLayer
          tokens={pageModel.tokens}
          pageHeight={pageModel.height}
          scale={scale}
          onSelectionEnd={handleSelectionCreate}
        />
      )}

      {/* Annotation layer for highlights (z-index: 2) */}
      {isRendered && (
        <>
          <RegionLayer
            regions={pageRegions}
            pageHeight={pageModel.height}
            scale={scale}
            selectedRegionId={selectedRegionId}
            onRegionClick={(region) => handleRegionClick(region)}
          />
          <AnnotationLayer
            spans={pageSpans}
            pageHeight={pageModel.height}
            scale={scale}
            selectedSpanId={selectedSpanId}
            onSpanClick={handleSpanClick}
          />
        </>
      )}

      {/* Page number */}
      <div className="absolute bottom-3 right-3 bg-white/90 text-slate-600 text-xs px-2.5 py-1 rounded-md z-10 border border-slate-200 shadow-sm">
        <span className="text-slate-400">p.</span>{pageModel.pageIndex + 1}
      </div>

      {/* Tag popover */}
      {popover && popover.span.id === selectedSpanId && (
        <TagPopover
          span={popover.span}
          anchorRect={popover.anchorRect}
          instanceCount={getInstanceCount(normalizeText(popover.span.text))}
          hasMultipleDocuments={hasMultipleDocuments}
          onChangeLabel={(label) => onSpanLabelChange(popover.span.id, label)}
          onChangeLabelAll={(label) => {
            onSpanLabelChangeAll(normalizeText(popover.span.text), label)
            setPopover(null)
          }}
          onChangeLabelAllDocuments={onSpanLabelChangeAllDocuments ? (label) => {
            onSpanLabelChangeAllDocuments(normalizeText(popover.span.text), label)
            setPopover(null)
          } : undefined}
          onRemove={() => {
            onSpanRemove(popover.span.id)
            setPopover(null)
          }}
          onRemoveAll={() => {
            onSpanRemoveAllByText(normalizeText(popover.span.text))
            setPopover(null)
          }}
          onRemoveAllDocuments={onSpanRemoveAllDocuments ? () => {
            onSpanRemoveAllDocuments(normalizeText(popover.span.text))
            setPopover(null)
          } : undefined}
          onClose={() => setPopover(null)}
        />
      )}

      {/* Label picker for new spans */}
      {labelPicker && (
        <LabelPicker
          anchorRect={labelPicker.anchorRect}
          selectedText={labelPicker.text}
          matchCount={countTextMatches(labelPicker.text)}
          hasMultipleDocuments={hasMultipleDocuments}
          onSelect={handleLabelSelect}
          onClose={() => setLabelPicker(null)}
        />
      )}
    </div>
  )
}
