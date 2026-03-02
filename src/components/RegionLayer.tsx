import type { RedactionRegion, BBox } from '../types'
import { ENTITY_COLORS } from '../types'
import { pdfToScreen } from '../pdf/geometry'

interface RegionLayerProps {
  regions: RedactionRegion[]
  pageHeight: number
  scale: number
  selectedRegionId: string | null
  onRegionClick: (region: RedactionRegion, anchorRect: DOMRect) => void
  previewAnonymized?: boolean
}

export function RegionLayer({
  regions,
  pageHeight,
  scale,
  selectedRegionId,
  onRegionClick,
  previewAnonymized,
}: RegionLayerProps) {
  const toScreen = (bbox: BBox) => pdfToScreen(bbox, pageHeight, scale)

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
      {regions.map((region) => {
        const bbox = toScreen(region.bbox)
        const isSelected = region.id === selectedRegionId
        const color = ENTITY_COLORS[region.label]

        return (
          <div
            key={region.id}
            className={`
              entity-highlight
              entity-${region.label}
              ${isSelected ? 'selected ring-2 ring-white' : ''}
            `}
            style={{
              left: bbox.x,
              top: bbox.y,
              width: bbox.width,
              height: bbox.height,
              backgroundColor: previewAnonymized ? '#1e293b' : color,
              opacity: previewAnonymized ? 1 : undefined,
              pointerEvents: 'auto',
              cursor: 'pointer',
            }}
            onClick={(e) => {
              e.stopPropagation()
              onRegionClick(region, (e.currentTarget as HTMLElement).getBoundingClientRect())
            }}
            title={`${region.kind}: ${region.label}`}
          />
        )
      })}
    </div>
  )
}

