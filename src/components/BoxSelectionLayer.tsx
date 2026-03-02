import { useCallback, useEffect, useRef, useState } from 'react'
import type { BBox } from '../types'

interface BoxSelectionLayerProps {
  onBoxDrawn: (screenBbox: BBox) => void
}

const MIN_SIZE = 5

export function BoxSelectionLayer({ onBoxDrawn }: BoxSelectionLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null)
  const [currentPt, setCurrentPt] = useState<{ x: number; y: number } | null>(null)

  const getLocalCoords = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const pt = getLocalCoords(e.clientX, e.clientY)
    if (!pt) return
    setStartPt(pt)
    setCurrentPt(pt)
  }, [getLocalCoords])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!startPt) return
    const pt = getLocalCoords(e.clientX, e.clientY)
    if (!pt) return
    setCurrentPt(pt)
  }, [startPt, getLocalCoords])

  const commitBox = useCallback((endX: number, endY: number) => {
    if (!startPt) return
    const x = Math.min(startPt.x, endX)
    const y = Math.min(startPt.y, endY)
    const width = Math.abs(endX - startPt.x)
    const height = Math.abs(endY - startPt.y)
    setStartPt(null)
    setCurrentPt(null)
    if (width >= MIN_SIZE && height >= MIN_SIZE) {
      onBoxDrawn({ x, y, width, height })
    }
  }, [startPt, onBoxDrawn])

  // Capture mouseup at window level to handle out-of-bounds release
  useEffect(() => {
    if (!startPt) return
    const handleMouseUp = (e: MouseEvent) => {
      const pt = getLocalCoords(e.clientX, e.clientY)
      commitBox(pt?.x ?? currentPt?.x ?? startPt.x, pt?.y ?? currentPt?.y ?? startPt.y)
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [startPt, currentPt, commitBox, getLocalCoords])

  // Compute the live preview rectangle
  const preview = startPt && currentPt
    ? {
        x: Math.min(startPt.x, currentPt.x),
        y: Math.min(startPt.y, currentPt.y),
        width: Math.abs(currentPt.x - startPt.x),
        height: Math.abs(currentPt.y - startPt.y),
      }
    : null

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ zIndex: 4, cursor: 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
    >
      {preview && preview.width >= 1 && preview.height >= 1 && (
        <div
          style={{
            position: 'absolute',
            left: preview.x,
            top: preview.y,
            width: preview.width,
            height: preview.height,
            border: '2px dashed #334155',
            backgroundColor: 'rgba(100, 116, 139, 0.1)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}
