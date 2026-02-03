import { useCallback } from 'react'
import React from 'react'
import type { DetectedSpan, BBox } from '../types'
import { ENTITY_COLORS } from '../types'
import { pdfToScreen, getPartialTokenBBox, mergeBBoxesByLine } from '../pdf/geometry'

interface AnnotationLayerProps {
  spans: DetectedSpan[]
  pageHeight: number
  scale: number
  selectedSpanId: string | null
  onSpanClick: (span: DetectedSpan, event: React.MouseEvent) => void
}

export function AnnotationLayer({
  spans,
  pageHeight,
  scale,
  selectedSpanId,
  onSpanClick,
}: AnnotationLayerProps) {
  // Get screen coordinates for a span, merged by line (one highlight per line)
  // Uses partial bboxes to highlight only the entity portion within each token
  const getSpanScreenBBoxes = useCallback((span: DetectedSpan): BBox[] => {
    if (!span.tokens || span.tokens.length === 0) {
      return []
    }

    // Get partial bboxes in PDF coordinates
    const partialBBoxes = span.tokens.map((token) =>
      getPartialTokenBBox(token, span.charStart, span.charEnd)
    )

    // Merge by line (one bbox per line)
    const mergedPdfBBoxes = mergeBBoxesByLine(partialBBoxes, 5)

    // Convert to screen coordinates
    return mergedPdfBBoxes.map(bbox => pdfToScreen(bbox, pageHeight, scale))
  }, [pageHeight, scale])

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
      {/* Span highlights */}
      {spans.map((span) => {
        const bboxes = getSpanScreenBBoxes(span)
        if (bboxes.length === 0) return null

        const isSelected = span.id === selectedSpanId
        const color = ENTITY_COLORS[span.label]

        return (
          <React.Fragment key={span.id}>
            {bboxes.map((bbox, i) => (
              <div
                key={`${span.id}-${i}`}
                className={`
                  entity-highlight
                  entity-${span.label}
                  ${isSelected ? 'selected ring-2 ring-white' : ''}
                `}
                style={{
                  left: bbox.x,
                  top: bbox.y,
                  width: bbox.width,
                  height: bbox.height,
                  backgroundColor: color,
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onSpanClick(span, e)
                }}
                title={`${span.label}: ${span.text}`}
              />
            ))}
          </React.Fragment>
        )
      })}
    </div>
  )
}
