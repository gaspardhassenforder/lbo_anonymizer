import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { Token, BBox, DetectedSpan } from '../types'
import { pdfToScreen } from '../pdf/geometry'

interface TextLayerProps {
  tokens: Token[]
  pageHeight: number
  scale: number
  selectedSpan?: DetectedSpan
  onSelectionEnd: (charStart: number, charEnd: number, text: string, anchorRect: DOMRect) => void
  onAdjacentHover?: (preview: { charStart: number; charEnd: number } | null) => void
  onExtendSpan?: (charStart: number, charEnd: number) => void
  disabled?: boolean
}

export function TextLayer({ tokens, pageHeight, scale, selectedSpan, onSelectionEnd, onAdjacentHover, onExtendSpan, disabled = false }: TextLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [startIdx, setStartIdx] = useState<number | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const isArmed = startIdx !== null

  // Boost z-index above AnnotationLayer when armed (so second click goes to TextLayer, not
  // AnnotationLayer's stopPropagation) or when a span popover is open (for hover-to-grow).
  const zIndex = isArmed || !!selectedSpan ? 3 : 1

  const reset = useCallback(() => {
    setStartIdx(null)
    setHoverIdx(null)
  }, [])

  const getTokenIdxFromEventTarget = useCallback((target: EventTarget | null): number | null => {
    const el = target instanceof Element ? target : null
    const tokenEl = el?.closest?.('[data-token-idx]') as Element | null
    if (!tokenEl) return null
    const raw = tokenEl.getAttribute('data-token-idx')
    const idx = raw ? Number.parseInt(raw, 10) : NaN
    return Number.isFinite(idx) ? idx : null
  }, [])

  const previewRange = useMemo(() => {
    if (startIdx === null) return null
    const end = hoverIdx ?? startIdx
    const min = Math.min(startIdx, end)
    const max = Math.max(startIdx, end)
    return { min, max }
  }, [startIdx, hoverIdx])

  const computeAnchorRectForRange = useCallback((min: number, max: number): DOMRect | null => {
    const root = layerRef.current
    if (!root) return null
    const rects: DOMRect[] = []
    for (let i = min; i <= max; i++) {
      const el = root.querySelector(`[data-token-idx="${i}"]`) as Element | null
      if (!el) continue
      rects.push(el.getBoundingClientRect())
    }
    if (rects.length === 0) return null
    const minX = Math.min(...rects.map((r) => r.left))
    const minY = Math.min(...rects.map((r) => r.top))
    const maxX = Math.max(...rects.map((r) => r.right))
    const maxY = Math.max(...rects.map((r) => r.bottom))
    return new DOMRect(minX, minY, maxX - minX, maxY - minY)
  }, [])

  const commitSelection = useCallback((endIdx: number) => {
    if (startIdx === null) return
    const min = Math.min(startIdx, endIdx)
    const max = Math.max(startIdx, endIdx)
    const selectedTokens = tokens.slice(min, max + 1).filter(Boolean)
    if (selectedTokens.length === 0) {
      reset()
      return
    }

    const charStart = Math.min(...selectedTokens.map((t) => t.charStart))
    const charEnd = Math.max(...selectedTokens.map((t) => t.charEnd))
    const text = selectedTokens.map((t) => t.text).join(' ')
    const anchorRect =
      computeAnchorRectForRange(min, max)
      ?? layerRef.current?.getBoundingClientRect()
    reset()
    if (anchorRect) {
      onSelectionEnd(charStart, charEnd, text, anchorRect)
    }
  }, [startIdx, tokens, onSelectionEnd, computeAnchorRectForRange, reset])

  // Escape cancels after first click
  useEffect(() => {
    if (!isArmed) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') reset()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isArmed, reset])

  // Click outside cancels after first click
  useEffect(() => {
    if (!isArmed) return
    const onDocDown = (e: globalThis.MouseEvent) => {
      const root = layerRef.current
      if (!root) return
      if (!root.contains(e.target as Node)) reset()
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [isArmed, reset])

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    // Prevent native browser selection (which is flaky with absolutely positioned tokens)
    e.preventDefault()
    // When a span popover is open and the user clicks on a token, stop mousedown propagation
    // so the popover's click-outside handler does not fire. The popover stays open during
    // hover-to-grow interactions and closes only when clicking on neutral (non-token) space.
    if (selectedSpan && !isArmed) {
      const idx = getTokenIdxFromEventTarget(e.target)
      if (idx !== null) {
        e.stopPropagation()
      }
    }
  }, [selectedSpan, isArmed, getTokenIdxFromEventTarget])

  const handleMouseMove = useCallback((e: ReactMouseEvent) => {
    const idx = getTokenIdxFromEventTarget(e.target)
    if (isArmed) {
      if (idx !== null) setHoverIdx(idx)
      return
    }
    if (!selectedSpan || idx === null) return
    setHoverIdx(idx)
    if (onAdjacentHover) {
      const token = tokens[idx]
      if (token.charEnd <= selectedSpan.charStart) {
        // Token is fully before the span → preview extending left to this token
        onAdjacentHover({ charStart: token.charStart, charEnd: selectedSpan.charEnd })
      } else if (token.charStart >= selectedSpan.charEnd) {
        // Token is fully after the span → preview extending right to this token
        onAdjacentHover({ charStart: selectedSpan.charStart, charEnd: token.charEnd })
      } else {
        // Token overlaps the span → clear preview
        onAdjacentHover(null)
      }
    }
  }, [isArmed, selectedSpan, getTokenIdxFromEventTarget, onAdjacentHover, tokens])

  const handleMouseLeave = useCallback(() => {
    onAdjacentHover?.(null)
  }, [onAdjacentHover])

  const handleClick = useCallback((e: ReactMouseEvent) => {
    const idx = getTokenIdxFromEventTarget(e.target)
    if (idx === null) return
    if (!isArmed) {
      if (selectedSpan && onExtendSpan) {
        const token = tokens[idx]
        if (token.charEnd <= selectedSpan.charStart) {
          // Extend the span left to include this token
          onExtendSpan(token.charStart, selectedSpan.charEnd)
          return
        }
        if (token.charStart >= selectedSpan.charEnd) {
          // Extend the span right to include this token
          onExtendSpan(selectedSpan.charStart, token.charEnd)
          return
        }
        // Token is inside (or overlapping) the current span — do nothing.
        // mousedown already stopped propagation, so the popover stays open.
        return
      }
      setStartIdx(idx)
      setHoverIdx(idx)
      return
    }
    commitSelection(idx)
  }, [isArmed, selectedSpan, onExtendSpan, getTokenIdxFromEventTarget, commitSelection, tokens])

  return (
    <div
      ref={layerRef}
      className="text-layer absolute inset-0"
      style={{ userSelect: 'none', cursor: 'text', zIndex, pointerEvents: disabled ? 'none' : undefined }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {tokens.map((token, idx) => {
        const screenBBox: BBox = pdfToScreen(token.bbox, pageHeight, scale)
        const isInPreview = !!previewRange && idx >= previewRange.min && idx <= previewRange.max
        const isAnchor = startIdx === idx
        return (
          <span
            key={idx}
            data-token-idx={idx}
            className={[
              'text-token',
              isInPreview ? 'selected' : '',
              isAnchor ? 'anchor' : '',
            ].filter(Boolean).join(' ')}
            style={{
              position: 'absolute',
              left: screenBBox.x,
              top: screenBBox.y,
              width: screenBBox.width,
              height: screenBBox.height,
              color: 'transparent',
              fontSize: `${screenBBox.height * 0.9}px`,
              lineHeight: `${screenBBox.height}px`,
              whiteSpace: 'pre',
            }}
          >
            {token.text}
          </span>
        )
      })}
    </div>
  )
}
