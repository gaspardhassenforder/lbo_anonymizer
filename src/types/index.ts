// Bounding box
export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

// Token represents a word or text segment with its position
export interface Token {
  id: string
  text: string
  bbox: BBox
  charStart: number
  charEnd: number
  pageIndex?: number // Optional, typically tracked at PageModel level
}

// Page model contains extracted text and tokens
export interface PageModel {
  pageIndex: number
  width: number
  height: number
  text: string
  tokens: Token[]
  hasOcr: boolean
}

// Entity labels we detect
export type EntityLabel =
  | 'PERSON'
  | 'ORGANIZATION'
  | 'ADDRESS'
  | 'EMAIL'
  | 'PHONE'
  | 'IBAN'
  | 'DATE'
  | 'SIREN'
  | 'SIRET'
  | 'CAPITAL'

// Entity labels array for iteration
export const ENTITY_LABELS: EntityLabel[] = [
  'PERSON',
  'ORGANIZATION',
  'ADDRESS',
  'EMAIL',
  'PHONE',
  'IBAN',
  'DATE',
  'SIREN',
  'SIRET',
  'CAPITAL',
]

// Entity colors for visualization
export const ENTITY_COLORS: Record<EntityLabel, string> = {
  PERSON: '#3b82f6',       // blue
  ORGANIZATION: '#8b5cf6', // violet
  ADDRESS: '#10b981',      // emerald
  EMAIL: '#f59e0b',        // amber
  PHONE: '#06b6d4',        // cyan
  IBAN: '#ec4899',         // pink
  DATE: '#6366f1',         // indigo
  SIREN: '#14b8a6',        // teal
  SIRET: '#0ea5e9',        // sky
  CAPITAL: '#a855f7',      // purple
}

// A detected span of text
export interface DetectedSpan {
  id: string
  label: EntityLabel
  text: string
  normalizedText: string
  tokens: Token[]
  confidence: number
  source: 'ner' | 'regex' | 'user'
  pageIndex: number
  charStart: number
  charEnd: number
}

// Tag entry for the tag map
export interface TagEntry {
  tag: string
  label: EntityLabel
  originalTexts: Set<string>
  count: number
}

// Processing stages
export type ProcessingStage = 'idle' | 'loading-pdf' | 'extracting-text' | 'running-ocr' | 'loading-model' | 'detecting-entities' | 'ready'

// Processing progress
export interface ProcessingProgress {
  stage: ProcessingStage
  progress: number
  message: string
}

// OCR Worker messages
export interface OcrWorkerRequest {
  type: 'INIT' | 'RECOGNIZE' | 'TERMINATE'
  imageData?: ImageData
  pageIndex?: number
  pageWidth?: number
  pageHeight?: number
  pdfWidth?: number
  pdfHeight?: number
}

export interface OcrWorkerResponse {
  type: 'INIT_COMPLETE' | 'INIT_ERROR' | 'PROGRESS' | 'RESULT' | 'ERROR'
  progress?: number
  tokens?: Token[]
  text?: string
  error?: string
  pageIndex?: number
}

// NER Worker messages
export interface NerWorkerRequest {
  type: 'LOAD_MODEL' | 'DETECT'
  text?: string
  pageIndex?: number
}

export interface NerWorkerResponse {
  type: 'MODEL_LOADING' | 'MODEL_LOADED' | 'MODEL_ERROR' | 'DETECTION_RESULT' | 'DETECTION_ERROR'
  progress?: number
  spans?: Array<Omit<DetectedSpan, 'id' | 'tokens'>>
  error?: string
}

// Page processing status for progressive loading
export type PageProcessingStatus = 'pending' | 'processing' | 'ready' | 'error'

// Model loading progress
export interface ModelLoadingProgress {
  loading: boolean
  progress: number
  error: string | null
}

// Edit actions for tagging
export type EditAction =
  | { type: 'ADD_SPAN'; span: DetectedSpan }
  | { type: 'REMOVE_SPAN'; spanId: string }
  | { type: 'CHANGE_LABEL'; spanId: string; newLabel: EntityLabel }

// Export types
export interface ExportedToken {
  text: string
  anonymizedText: string
  bbox: BBox
  isEntity: boolean
  entityLabel?: EntityLabel
  tag?: string
}

export interface ExportedSpan {
  label: EntityLabel
  originalText: string
  tag: string
  charStart: number
  charEnd: number
}

export interface ExportedPage {
  pageIndex: number
  originalText: string
  anonymizedText: string
  tokens: ExportedToken[]
  spans: ExportedSpan[]
}

export interface ExportedDocument {
  filename: string
  exportedAt: string
  pageCount: number
  pages: ExportedPage[]
  tagMap: Record<string, { tag: string; label: EntityLabel; count: number }>
  entitySummary: Record<EntityLabel, number>
}
