import { useCallback } from 'react'
import React from 'react'
import type { DetectedSpan, BBox, Token, EntityLabel } from '../types'
import { ENTITY_COLORS } from '../types'
import { pdfToScreen, getPartialTokenBBox, mergeBBoxesByLine } from '../pdf/geometry'

interface AnnotationLayerProps {
  spans: DetectedSpan[]
  pageHeight: number
  scale: number
  selectedSpanId: string | null
  extensionPreview?: {
    charStart: number
    charEnd: number
    tokens: Token[]
    label: EntityLabel
  } | null
  onSpanClick: (span: DetectedSpan, event: React.MouseEvent) => void
}

export function AnnotationLayer({
  spans,
  pageHeight,
  scale,
  selectedSpanId,
  extensionPreview,
  onSpanClick,
}: AnnotationLayerProps) {
  // Get screen coordinates for a span, merged by line (one highlight per line)
  // Uses partial bboxes to highlight only the entity portion within each token
  const getSpanScreenBBoxes = useCallback((span: { tokens: Token[]; charStart: number; charEnd: number }): BBox[] => {
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
      {/* Ghost preview for hover-to-grow extension */}
      {extensionPreview && (() => {
        const ghostBBoxes = getSpanScreenBBoxes(extensionPreview)
        const ghostColor = ENTITY_COLORS[extensionPreview.label]
        return ghostBBoxes.map((bbox, i) => (
          <div
            key={`ghost-${i}`}
            style={{
              position: 'absolute',
              left: bbox.x,
              top: bbox.y,
              width: bbox.width,
              height: bbox.height,
              backgroundColor: ghostColor,
              opacity: 0.4,
              pointerEvents: 'none',
            }}
          />
        ))
      })()}

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
                  ${isSelected ? 'selected ring-[3px] ring-white' : ''}
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
