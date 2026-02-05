import type { DetectedSpan, Token } from '../types'

interface Line {
  tokens: Token[]
  centerY: number
  maxHeight: number
}

const DOCUSIGNED = 'docusigned'
const BY = 'by'

const ID_MAX_LINE_GAP_MULTIPLIER = 10

function normalizeTokenText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function groupTokensIntoLines(tokens: Token[], lineThreshold: number): Line[] {
  const lines: Line[] = []
  const sorted = [...tokens].sort((a, b) => {
    const ay = a.bbox.y + a.bbox.height / 2
    const by = b.bbox.y + b.bbox.height / 2
    if (Math.abs(ay - by) > lineThreshold) {
      return by - ay
    }
    return a.bbox.x - b.bbox.x
  })

  for (const token of sorted) {
    const centerY = token.bbox.y + token.bbox.height / 2
    let line = lines.find((l) => Math.abs(l.centerY - centerY) <= lineThreshold)
    if (!line) {
      line = { tokens: [], centerY, maxHeight: 0 }
      lines.push(line)
    }
    line.tokens.push(token)
    line.centerY =
      (line.centerY * (line.tokens.length - 1) + centerY) / line.tokens.length
    line.maxHeight = Math.max(line.maxHeight, token.bbox.height)
  }

  // Sort tokens left-to-right within each line
  for (const line of lines) {
    line.tokens.sort((a, b) => a.bbox.x - b.bbox.x)
  }

  // Sort lines top-to-bottom (higher y first)
  lines.sort((a, b) => b.centerY - a.centerY)
  return lines
}

function isAnchorLine(line: Line): boolean {
  const normalized = line.tokens.map((t) => normalizeTokenText(t.text))
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] !== DOCUSIGNED) continue
    const byIndex = normalized.findIndex((t, idx) => idx > i && idx <= i + 3 && t === BY)
    if (byIndex !== -1) {
      return true
    }
  }
  return false
}

function getLineMinY(line: Line): number {
  return Math.min(...line.tokens.map((t) => t.bbox.y))
}


function isLikelyId(text: string): boolean {
  const normalized = text.replace(/[^a-z0-9]/gi, '')
  if (normalized.length < 8) return false
  if (!/^[a-z0-9]+$/i.test(normalized)) return false
  return /\d/.test(normalized)
}

function buildSpanFromTokens(
  tokens: Token[],
  label: DetectedSpan['label'],
  pageIndex: number,
  confidence: number,
  source: DetectedSpan['source']
): Omit<DetectedSpan, 'id' | 'tokens'> | null {
  if (tokens.length === 0) return null
  const sorted = [...tokens].sort((a, b) => a.charStart - b.charStart)
  const charStart = sorted[0].charStart
  const charEnd = sorted[sorted.length - 1].charEnd
  const text = sorted.map((t) => t.text).join(' ')
  return {
    label,
    text,
    normalizedText: text.trim().toLowerCase().replace(/\s+/g, ' '),
    confidence,
    source,
    pageIndex,
    charStart,
    charEnd,
  }
}

export function detectDocuSignSignatures(
  tokens: Token[],
  pageIndex: number
): Array<Omit<DetectedSpan, 'id' | 'tokens'>> {
  if (tokens.length === 0) return []

  const heights = tokens.map((t) => t.bbox.height).filter((h) => h > 0)
  const medianHeight = median(heights)
  if (medianHeight === 0) return []

  const lineThreshold = Math.max(2, medianHeight * 0.6)
  const lines = groupTokensIntoLines(tokens, lineThreshold)
  const spans: Array<Omit<DetectedSpan, 'id' | 'tokens'>> = []

  const idMaxGap = medianHeight * ID_MAX_LINE_GAP_MULTIPLIER

  const anchorLines = lines.filter(isAnchorLine)

  for (const anchorLine of anchorLines) {
    const anchorCenterY = anchorLine.centerY
    const idLine = lines.find((line) => {
      const deltaY = anchorCenterY - line.centerY
      if (deltaY <= 0 || deltaY > idMaxGap) return false
      return line.tokens.some((t) => isLikelyId(t.text))
    })

    if (!idLine) continue

    const bandTop = getLineMinY(anchorLine)
    const bandBottom = getLineMinY(idLine)

    const anchorTokenIds = new Set(anchorLine.tokens.map((t) => t.id))

    const candidates = tokens.filter((token) => {
      if (anchorTokenIds.has(token.id)) return false
      const tokenMinY = token.bbox.y
      const tokenMaxY = token.bbox.y + token.bbox.height
      return tokenMaxY >= bandBottom && tokenMinY <= bandTop
    })

    if (candidates.length === 0) continue

    const minX = Math.min(...candidates.map((t) => t.bbox.x))
    const maxX = Math.max(...candidates.map((t) => t.bbox.x + t.bbox.width))

    const finalTokens = candidates.filter((token) => {
      const tokenMinX = token.bbox.x
      const tokenMaxX = token.bbox.x + token.bbox.width
      return tokenMaxX >= minX && tokenMinX <= maxX
    })

    const combinedSpan = buildSpanFromTokens(
      finalTokens,
      'IDENTIFIER',
      pageIndex,
      0.85,
      'regex'
    )

    if (combinedSpan) {
      spans.push(combinedSpan)
    }
  }

  return spans
}
