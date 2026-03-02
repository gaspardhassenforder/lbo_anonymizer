import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { PageModel, DetectedSpan, EntityLabel, RedactionRegion, Token, BBox } from '../types'
import { cleanupCanvas } from '../pdf/render'
import { screenToPdf } from '../pdf/geometry'
import { AnnotationLayer } from './AnnotationLayer'
import { BoxSelectionLayer } from './BoxSelectionLayer'
import { RegionLayer } from './RegionLayer'
import { TextLayer } from './TextLayer'
import { TagPopover, LabelPicker, RegionTagPopover } from './TagPopover'
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
  onSpanExtend?: (spanId: string, charStart: number, charEnd: number, pageText: string, pageTokens: Token[]) => void
  countTextMatches: (text: string) => number
  getInstanceCount: (normalizedText: string) => number
  previewAnonymized?: boolean
  selectionMode?: 'token' | 'box'
  onRegionAdd?: (pageIndex: number, bbox: BBox, label: EntityLabel) => void
  onRegionRemove?: (regionId: string) => void
  onRegionLabelChange?: (regionId: string, label: EntityLabel) => void
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
  onSpanExtend,
  countTextMatches,
  getInstanceCount,
  previewAnonymized,
  selectionMode = 'token',
  onRegionAdd,
  onRegionRemove,
  onRegionLabelChange,
}: PageViewProps) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const [isRendered, setIsRendered] = useState(false)
  const [popover, setPopover] = useState<{
    spanId: string
    anchorRect: DOMRect
  } | null>(null)
  const [regionPopover, setRegionPopover] = useState<{
    regionId: string
    anchorRect: DOMRect
  } | null>(null)
  const [extensionPreview, setExtensionPreview] = useState<{
    charStart: number
    charEnd: number
    tokens: Token[]
    label: EntityLabel
  } | null>(null)
  const [labelPicker, setLabelPicker] = useState<{
    charStart: number
    charEnd: number
    text: string
    anchorRect: DOMRect
  } | null>(null)
  const [boxLabelPicker, setBoxLabelPicker] = useState<{
    pdfBbox: BBox
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

  // Filter spans/regions for this page, memoized for stable references in callbacks
  const pageSpans = useMemo(
    () => spans.filter((s) => s.pageIndex === pageModel.pageIndex),
    [spans, pageModel.pageIndex]
  )
  const pageRegions = useMemo(
    () => regions.filter((r) => r.pageIndex === pageModel.pageIndex),
    [regions, pageModel.pageIndex]
  )

  // The "active" span is the one whose popover is open.
  // Hover-to-grow is only active while the popover is visible, so we derive from popover state
  // (not from selectedSpanId, which stays set even after the popover closes).
  const popoverSpan = useMemo(
    () => (popover ? pageSpans.find((s) => s.id === popover.spanId) ?? null : null),
    [popover, pageSpans]
  )
  const selectedSpan = popoverSpan

  // Clear extension preview whenever the popover closes or switches span
  useEffect(() => {
    setExtensionPreview(null)
  }, [popover?.spanId])

  // Handle span click — open the popover anchored to the clicked highlight
  const handleSpanClick = useCallback((span: DetectedSpan, event: React.MouseEvent) => {
    onSpanClick(span)
    const targetRect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    setPopover({ spanId: span.id, anchorRect: targetRect })
  }, [onSpanClick])

  const handleRegionClick = useCallback((region: RedactionRegion, anchorRect: DOMRect) => {
    onRegionClick(region)
    setRegionPopover({ regionId: region.id, anchorRect })
  }, [onRegionClick])

  // Receive hover position from TextLayer; build a ghost preview in the entity's color
  const handleAdjacentHover = useCallback((preview: { charStart: number; charEnd: number } | null) => {
    if (!preview || !selectedSpan) {
      setExtensionPreview(null)
      return
    }
    const previewTokens = pageModel.tokens.filter(
      (t) => t.charEnd > preview.charStart && t.charStart < preview.charEnd
    )
    setExtensionPreview({
      charStart: preview.charStart,
      charEnd: preview.charEnd,
      tokens: previewTokens,
      label: selectedSpan.label,
    })
  }, [selectedSpan, pageModel.tokens])

  // Extend the active span to cover a new range and absorb any spans that become fully contained
  const handleExtendSpan = useCallback((charStart: number, charEnd: number) => {
    if (!selectedSpan || !onSpanExtend) return
    onSpanExtend(selectedSpan.id, charStart, charEnd, pageModel.text, pageModel.tokens)
    // Remove any other same-page spans that are now fully contained within the new bounds
    pageSpans.forEach((s) => {
      if (s.id !== selectedSpan.id && s.charStart >= charStart && s.charEnd <= charEnd) {
        onSpanRemove(s.id)
      }
    })
  }, [selectedSpan, onSpanExtend, onSpanRemove, pageSpans, pageModel.text, pageModel.tokens])

  // Handle text selection: overlap-to-merge when the new range touches an existing span,
  // otherwise open the label picker for a brand-new annotation
  const handleSelectionCreate = useCallback((charStart: number, charEnd: number, text: string, anchorRect: DOMRect) => {
    const overlapping = pageSpans.filter((s) => s.charEnd > charStart && s.charStart < charEnd)
    if (overlapping.length > 0) {
      // Prefer the currently selected span as merge target, else pick the first overlapping one
      const target = overlapping.find((s) => s.id === selectedSpanId) ?? overlapping[0]
      // Extend to the union of all overlapping spans + the new selection
      const newStart = Math.min(...overlapping.map((s) => s.charStart), charStart)
      const newEnd = Math.max(...overlapping.map((s) => s.charEnd), charEnd)
      onSpanExtend?.(target.id, newStart, newEnd, pageModel.text, pageModel.tokens)
      // Remove other spans now absorbed into the target
      overlapping.forEach((s) => {
        if (s.id !== target.id) onSpanRemove(s.id)
      })
      return
    }
    setLabelPicker({ charStart, charEnd, text, anchorRect })
  }, [pageSpans, selectedSpanId, onSpanExtend, onSpanRemove, pageModel.text, pageModel.tokens])

  // Handle label selection for new span
  const handleLabelSelect = useCallback((label: EntityLabel, scope: ScopeOption) => {
    if (!labelPicker) return
    onSpanAdd(labelPicker.charStart, labelPicker.charEnd, labelPicker.text, label, scope)
    setLabelPicker(null)
  }, [labelPicker, onSpanAdd])

  // Handle a box drawn in BoxSelectionLayer — convert to PDF coords and open label picker
  const handleBoxDrawn = useCallback((screenBbox: BBox) => {
    const pdfBbox = screenToPdf(screenBbox, pageModel.height, scale)
    const containerRect = containerRef.current?.getBoundingClientRect()
    if (!containerRect) return
    const anchorRect = new DOMRect(
      containerRect.left + screenBbox.x,
      containerRect.top + screenBbox.y,
      screenBbox.width,
      screenBbox.height,
    )
    setBoxLabelPicker({ pdfBbox, anchorRect })
  }, [pageModel.height, scale])

  // Handle label selection for a drawn box region
  const handleBoxLabelSelect = useCallback((label: EntityLabel) => {
    if (!boxLabelPicker) return
    onRegionAdd?.(pageModel.pageIndex, boxLabelPicker.pdfBbox, label)
    setBoxLabelPicker(null)
  }, [boxLabelPicker, onRegionAdd, pageModel.pageIndex])

  // Page dimensions
  const width = pageModel.width * scale
  const height = pageModel.height * scale

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

      {/* Text layer for selection and hover-to-grow (z-index managed dynamically inside TextLayer) */}
      {isRendered && (
        <TextLayer
          tokens={pageModel.tokens}
          pageHeight={pageModel.height}
          scale={scale}
          selectedSpan={selectedSpan ?? undefined}
          onSelectionEnd={handleSelectionCreate}
          onAdjacentHover={handleAdjacentHover}
          onExtendSpan={handleExtendSpan}
          disabled={selectionMode === 'box'}
        />
      )}

      {/* Box selection overlay — only visible in box mode */}
      {isRendered && selectionMode === 'box' && (
        <BoxSelectionLayer onBoxDrawn={handleBoxDrawn} />
      )}

      {/* Annotation layer for highlights (z-index: 2) */}
      {isRendered && (
        <>
          <RegionLayer
            regions={pageRegions}
            pageHeight={pageModel.height}
            scale={scale}
            selectedRegionId={selectedRegionId}
            onRegionClick={(region, anchorRect) => handleRegionClick(region, anchorRect)}
            previewAnonymized={previewAnonymized}
          />
          <AnnotationLayer
            spans={pageSpans}
            pageHeight={pageModel.height}
            scale={scale}
            selectedSpanId={selectedSpanId}
            extensionPreview={extensionPreview}
            onSpanClick={handleSpanClick}
            previewAnonymized={previewAnonymized}
          />
        </>
      )}

      {/* Page number */}
      <div className="absolute bottom-3 right-3 bg-white/90 text-slate-600 text-xs px-2.5 py-1 rounded-md z-10 border border-slate-200 shadow-sm">
        <span className="text-slate-400">p.</span>{pageModel.pageIndex + 1}
      </div>

      {/* Tag popover — shown for the span whose popover was opened, only while it still exists */}
      {popoverSpan && popover && popover.spanId === selectedSpanId && (
        <TagPopover
          span={popoverSpan}
          anchorRect={popover.anchorRect}
          instanceCount={getInstanceCount(normalizeText(popoverSpan.text))}
          hasMultipleDocuments={hasMultipleDocuments}
          onChangeLabel={(label) => onSpanLabelChange(popoverSpan.id, label)}
          onChangeLabelAll={(label) => {
            onSpanLabelChangeAll(normalizeText(popoverSpan.text), label)
            setPopover(null)
          }}
          onChangeLabelAllDocuments={onSpanLabelChangeAllDocuments ? (label) => {
            onSpanLabelChangeAllDocuments(normalizeText(popoverSpan.text), label)
            setPopover(null)
          } : undefined}
          onRemove={() => {
            onSpanRemove(popoverSpan.id)
            setPopover(null)
          }}
          onRemoveAll={() => {
            onSpanRemoveAllByText(normalizeText(popoverSpan.text))
            setPopover(null)
          }}
          onRemoveAllDocuments={onSpanRemoveAllDocuments ? () => {
            onSpanRemoveAllDocuments(normalizeText(popoverSpan.text))
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

      {/* Region tag popover — edit label or remove a drawn / PDF-annotation region */}
      {regionPopover && (() => {
        const region = pageRegions.find((r) => r.id === regionPopover.regionId)
        if (!region) return null
        return (
          <RegionTagPopover
            region={region}
            anchorRect={regionPopover.anchorRect}
            onChangeLabel={(label) => {
              onRegionLabelChange?.(region.id, label)
              setRegionPopover(null)
            }}
            onRemove={() => {
              onRegionRemove?.(region.id)
              setRegionPopover(null)
            }}
            onClose={() => setRegionPopover(null)}
          />
        )
      })()}

      {/* Label picker for drawn box regions (no scope — one-off redaction) */}
      {boxLabelPicker && (
        <LabelPicker
          anchorRect={boxLabelPicker.anchorRect}
          selectedText={t('boxSelection.label')}
          matchCount={0}
          noScope={true}
          onSelect={(label) => handleBoxLabelSelect(label)}
          onClose={() => setBoxLabelPicker(null)}
        />
      )}
    </div>
  )
}
