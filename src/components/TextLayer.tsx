import { useCallback } from 'react'
import type { Token, BBox } from '../types'
import { pdfToScreen } from '../pdf/geometry'

interface TextLayerProps {
  tokens: Token[]
  pageHeight: number
  scale: number
  onSelectionEnd: (charStart: number, charEnd: number, text: string, anchorRect: DOMRect) => void
}

export function TextLayer({ tokens, pageHeight, scale, onSelectionEnd }: TextLayerProps) {
  const handleMouseUp = useCallback(() => {
    const selection = document.getSelection()
    if (!selection || selection.isCollapsed) return

    // Find selected tokens from data-token-idx attributes
    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer

    // Find all spans with data-token-idx within or containing the selection
    let selectedTokenIndices: number[] = []

    // Walk up to find our container
    let root: Element | null = container instanceof Element
      ? container
      : container.parentElement

    // If we're inside a token span, get that span's layer parent
    while (root && !root.classList?.contains('text-layer')) {
      root = root.parentElement
    }

    if (!root) {
      selection.removeAllRanges()
      return
    }

    // Get all token spans and check which ones are in the selection
    const tokenSpans = root.querySelectorAll('[data-token-idx]')
    for (const span of tokenSpans) {
      if (selection.containsNode(span, true)) {
        const idx = parseInt(span.getAttribute('data-token-idx') || '-1', 10)
        if (idx >= 0) {
          selectedTokenIndices.push(idx)
        }
      }
    }

    // Sort and get unique indices
    selectedTokenIndices = [...new Set(selectedTokenIndices)].sort((a, b) => a - b)

    if (selectedTokenIndices.length === 0) {
      selection.removeAllRanges()
      return
    }

    // Map to charStart/charEnd
    const selectedTokens = selectedTokenIndices.map(idx => tokens[idx]).filter(Boolean)
    if (selectedTokens.length === 0) {
      selection.removeAllRanges()
      return
    }

    const charStart = Math.min(...selectedTokens.map(t => t.charStart))
    const charEnd = Math.max(...selectedTokens.map(t => t.charEnd))
    const text = selectedTokens.map(t => t.text).join(' ')

    // Get bounding rect from the selected token spans for popover positioning
    const selectedSpans = selectedTokenIndices
      .map(idx => root!.querySelector(`[data-token-idx="${idx}"]`))
      .filter(Boolean) as Element[]

    let anchorRect: DOMRect
    if (selectedSpans.length > 0) {
      // Compute bounding rect of all selected spans
      const rects = selectedSpans.map(span => span.getBoundingClientRect())
      const minX = Math.min(...rects.map(r => r.left))
      const minY = Math.min(...rects.map(r => r.top))
      const maxX = Math.max(...rects.map(r => r.right))
      const maxY = Math.max(...rects.map(r => r.bottom))
      anchorRect = new DOMRect(minX, minY, maxX - minX, maxY - minY)
    } else {
      // Fallback: use range bounding rect
      anchorRect = range.getBoundingClientRect()
    }

    // Clear browser selection after processing
    selection.removeAllRanges()

    onSelectionEnd(charStart, charEnd, text, anchorRect)
  }, [tokens, onSelectionEnd])

  return (
    <div
      className="text-layer absolute inset-0"
      style={{ userSelect: 'text', cursor: 'text', zIndex: 1 }}
      onMouseUp={handleMouseUp}
    >
      {tokens.map((token, idx) => {
        const screenBBox: BBox = pdfToScreen(token.bbox, pageHeight, scale)
        return (
          <span
            key={idx}
            data-token-idx={idx}
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
