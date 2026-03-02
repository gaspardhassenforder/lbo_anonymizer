import { create } from 'zustand'
import { temporal } from 'zundo'
import { immer } from 'zustand/middleware/immer'
import { persist, createJSONStorage, PersistOptions } from 'zustand/middleware'
import { enableMapSet } from 'immer'
import { clearPdf } from './pdfPersistence'
import type { DocumentMeta } from './documentsPersistence'
import type {
  PageModel,
  DetectedSpan,
  RedactionRegion,
  TagEntry,
  ProcessingProgress,
  EntityLabel,
  PageProcessingStatus,
  ModelLoadingProgress,
  Token,
} from '../types'
import { normalizeEntityLabel } from '../types'
import { findTokensInRange } from '../pdf/textExtraction'

// Enable Map and Set support for immer
enableMapSet()

// Session storage key
const STORAGE_KEY = 'lbo-anonymizer-session'

// User type for auth
export interface User {
  id: number
  username: string
}

// Browser-only documents metadata (full data lives in IndexedDB)
export type SavedDocumentMeta = DocumentMeta

interface AppState {
  // Auth state
  isAuthenticated: boolean
  user: User | null
  token: string | null

  // Document state
  file: File | null
  pages: PageModel[]
  spans: DetectedSpan[]
  regions: RedactionRegion[]
  tagMap: Map<string, TagEntry>

  // Corpus-wide rules (persisted in IndexedDB; also cached in sessionStorage for this tab)
  suppressedTexts: Set<string>              // Normalized texts to never detect / keep
  labelOverrides: Map<string, EntityLabel>  // Forced label for normalized text
  forcedLabels: Map<string, EntityLabel>    // Force-add spans for normalized text on future docs

  // UI state
  selectedSpanId: string | null
  selectedRegionId: string | null
  confidenceThreshold: number
  zoom: number
  currentPage: number
  isDirty: boolean

  // Processing state
  processing: ProcessingProgress

  // Model loading state
  modelsReady: boolean
  modelLoadingProgress: {
    ocr: ModelLoadingProgress
    ner: ModelLoadingProgress
  }

  // Per-page processing status
  pageProcessingStatus: Map<number, PageProcessingStatus>
  totalPageCount: number

  // Auth actions
  login: (user: User, token: string) => void
  logout: () => void

  // Saved documents metadata (browser-only mode - full data persisted in IndexedDB)
  savedDocuments: SavedDocumentMeta[]
  setSavedDocuments: (docs: SavedDocumentMeta[]) => void
  addSavedDocument: (doc: SavedDocumentMeta) => void
  updateSavedDocument: (doc: SavedDocumentMeta) => void
  removeSavedDocument: (id: string) => void
  getSavedDocument: (id: string) => SavedDocumentMeta | undefined

  // Document loading from server (kept for compatibility, but now loads from savedDocuments)
  loadedDocumentId: string | null
  setLoadedDocumentId: (id: string | null) => void

  // Actions
  setFile: (file: File | null) => void
  setPages: (pages: PageModel[]) => void
  setSpans: (spans: DetectedSpan[]) => void
  setRegions: (regions: RedactionRegion[]) => void
  addSpan: (span: DetectedSpan) => void
  addSpans: (spans: DetectedSpan[]) => void
  addPage: (page: PageModel) => void
  addPageSpans: (spans: DetectedSpan[]) => void
  addPageRegions: (regions: RedactionRegion[]) => void
  removeSpan: (spanId: string) => void
  removeSpansByNormalizedText: (normalizedText: string) => number
  findSpansByNormalizedText: (normalizedText: string) => DetectedSpan[]
  updateSpanLabel: (spanId: string, label: EntityLabel) => void
  updateSpanLabelByNormalizedText: (normalizedText: string, label: EntityLabel) => number
  updateSpanBounds: (spanId: string, charStart: number, charEnd: number, pageText: string, pageTokens: Token[]) => void
  removeRegion: (regionId: string) => void
  updateRegionLabel: (regionId: string, label: EntityLabel) => void
  suppressText: (normalizedText: string) => void
  setLabelOverride: (normalizedText: string, label: EntityLabel) => void
  setForcedLabel: (normalizedText: string, label: EntityLabel) => void
  removeSuppressedText: (normalizedText: string) => void
  removeLabelOverride: (normalizedText: string) => void
  removeForcedLabel: (normalizedText: string) => void
  setSelectedSpan: (spanId: string | null) => void
  setSelectedRegion: (regionId: string | null) => void
  setConfidenceThreshold: (threshold: number) => void
  setZoom: (zoom: number) => void
  setCurrentPage: (page: number) => void
  setDirty: (dirty: boolean) => void
  setProcessing: (progress: ProcessingProgress) => void
  setModelsReady: (ready: boolean) => void
  setModelLoadingProgress: (model: 'ocr' | 'ner', progress: ModelLoadingProgress) => void
  setTotalPageCount: (count: number) => void
  setPageProcessingStatus: (pageIndex: number, status: PageProcessingStatus) => void
  updateTagMap: () => void
  setCorpusRules: (rules: { suppressedTexts: Set<string>; labelOverrides: Map<string, EntityLabel>; forcedLabels: Map<string, EntityLabel> }) => void
  reset: () => void
}

const initialState = {
  // Auth state
  isAuthenticated: false,
  user: null as User | null,
  token: null as string | null,

  // Saved documents (browser-only mode)
  savedDocuments: [] as SavedDocumentMeta[],

  // Document loading
  loadedDocumentId: null as string | null,

  // Document state
  file: null,
  pages: [],
  spans: [],
  regions: [],
  tagMap: new Map<string, TagEntry>(),
  suppressedTexts: new Set<string>(),
  labelOverrides: new Map<string, EntityLabel>(),
  forcedLabels: new Map<string, EntityLabel>(),
  selectedSpanId: null,
  selectedRegionId: null,
  confidenceThreshold: 0.5,
  zoom: 1,
  currentPage: 0,
  isDirty: false,
  processing: {
    stage: 'idle' as const,
    progress: 0,
    message: '',
  },
  modelsReady: false,
  modelLoadingProgress: {
    ocr: { loading: false, progress: 0, error: null },
    ner: { loading: false, progress: 0, error: null },
  },
  pageProcessingStatus: new Map<number, PageProcessingStatus>(),
  totalPageCount: 0,
}

// JSON reviver for Map/Set deserialization
function jsonReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (obj.__type === 'Map' && Array.isArray(obj.entries)) {
      return new Map(obj.entries as [unknown, unknown][])
    }
    if (obj.__type === 'Set' && Array.isArray(obj.values)) {
      return new Set(obj.values)
    }
  }
  return value
}

// JSON replacer for Map/Set serialization
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return { __type: 'Map', entries: Array.from(value.entries()) }
  }
  if (value instanceof Set) {
    return { __type: 'Set', values: Array.from(value) }
  }
  return value
}

// Persistence configuration
// Documents are persisted in IndexedDB; we only persist auth + editor session + corpus rules cache.
type PersistedState = Pick<AppState,
  'isAuthenticated' | 'user' | 'token' |
  'pages' | 'spans' | 'regions' | 'suppressedTexts' | 'labelOverrides' | 'forcedLabels' |
  'currentPage' | 'confidenceThreshold' | 'totalPageCount' | 'pageProcessingStatus' | 'isDirty' |
  'loadedDocumentId'
>

const persistConfig: PersistOptions<AppState, PersistedState> = {
  name: STORAGE_KEY,
  storage: createJSONStorage(() => sessionStorage, {
    reviver: jsonReviver,
    replacer: jsonReplacer,
  }),
  // Persist auth state and essential document state
  partialize: (state): PersistedState => ({
    isAuthenticated: state.isAuthenticated,
    user: state.user,
    token: state.token,
    pages: state.pages,
    spans: state.spans,
    regions: state.regions,
    suppressedTexts: state.suppressedTexts,
    labelOverrides: state.labelOverrides,
    forcedLabels: state.forcedLabels,
    currentPage: state.currentPage,
    confidenceThreshold: state.confidenceThreshold,
    totalPageCount: state.totalPageCount,
    pageProcessingStatus: state.pageProcessingStatus,
    isDirty: state.isDirty,
    loadedDocumentId: state.loadedDocumentId,
  }),
  // After hydration, normalize legacy labels and rebuild derived state
  onRehydrateStorage: () => (state) => {
    if (state) {
      // Normalize legacy entity labels (EMAIL, PHONE, etc. → IDENTIFIER)
      state.spans.forEach((s) => {
        s.label = normalizeEntityLabel(s.label)
      })
      state.regions.forEach((r) => {
        r.label = normalizeEntityLabel(r.label)
      })
      state.labelOverrides = new Map(
        Array.from(state.labelOverrides.entries()).map(([k, v]) => [k, normalizeEntityLabel(v)])
      )
      state.forcedLabels = new Map(
        Array.from(state.forcedLabels.entries()).map(([k, v]) => [k, normalizeEntityLabel(v)])
      )
      console.log('[Store] Rehydrated from sessionStorage:', {
        pages: state.pages.length,
        spans: state.spans.length,
        currentPage: state.currentPage,
      })
      // Rebuild tagMap from spans
      state.updateTagMap()
      // Mark processing as ready if we have pages
      if (state.pages.length > 0) {
        state.setProcessing({ stage: 'ready', progress: 100, message: 'Restored from session' })
      }
    }
  },
}

// Normalize text for consistent tag mapping
export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Generate tag from label and index
function generateTag(label: EntityLabel, index: number): string {
  return `[${label}_${index}]`
}

export const useStore = create<AppState>()(
  persist(
    temporal(
      immer((set, get) => ({
        ...initialState,

      // Auth actions
      login: (user, token) => set((state) => {
        state.isAuthenticated = true
        state.user = user
        state.token = token
      }),

      logout: () => {
        // Clear IndexedDB (async, fire-and-forget)
        clearPdf().catch(err => console.warn('[Store] Failed to clear IndexedDB on logout:', err))

        // Clear sessionStorage
        sessionStorage.removeItem(STORAGE_KEY)

        // Reset store state
        set((state) => {
          state.isAuthenticated = false
          state.user = null
          state.token = null
          // Also reset document state for security
          state.file = null
          state.pages = []
          state.spans = []
          state.regions = []
          state.tagMap = new Map()
          state.suppressedTexts = new Set()
          state.labelOverrides = new Map()
          state.forcedLabels = new Map()
          state.selectedSpanId = null
          state.selectedRegionId = null
          state.pageProcessingStatus = new Map()
          state.totalPageCount = 0
          state.loadedDocumentId = null
          state.savedDocuments = [] // Clear metadata list on logout (data in IndexedDB may remain)
          state.processing = { stage: 'idle', progress: 0, message: '' }
          state.isDirty = false
        })
      },

      setLoadedDocumentId: (id) => set((state) => {
        state.loadedDocumentId = id
      }),

      // Saved documents actions (browser-only mode)
      setSavedDocuments: (docs) => set((state) => {
        state.savedDocuments = docs
      }),

      addSavedDocument: (doc) => set((state) => {
        const idx = state.savedDocuments.findIndex((d) => d.id === doc.id)
        if (idx === -1) state.savedDocuments.push(doc)
        else state.savedDocuments[idx] = doc
      }),

      updateSavedDocument: (doc) => set((state) => {
        const idx = state.savedDocuments.findIndex((d) => d.id === doc.id)
        if (idx === -1) state.savedDocuments.push(doc)
        else state.savedDocuments[idx] = doc
      }),

      removeSavedDocument: (id) => set((state) => {
        state.savedDocuments = state.savedDocuments.filter(d => d.id !== id)
      }),

      getSavedDocument: (id) => {
        return get().savedDocuments.find(d => d.id === id)
      },

      setFile: (file) => set((state) => {
        state.file = file
      }),

      setPages: (pages) => set((state) => {
        state.pages = pages
      }),

      setSpans: (spans) => {
        set((state) => {
          state.spans = spans
        })
        // Update tag map AFTER set() completes to ensure state is synchronized
        get().updateTagMap()
      },

      setRegions: (regions) => set((state) => {
        state.regions = regions
      }),

      addSpan: (span) => {
        set((state) => {
          state.spans.push(span)
        })
        // Update tag map AFTER set() completes to ensure state is synchronized
        get().updateTagMap()
      },

      addSpans: (spans) => {
        if (spans.length === 0) return
        set((state) => {
          state.spans.push(...spans)
        })
        get().updateTagMap()
      },

      addPage: (page) => {
        set((state) => {
          // Insert page in the correct position (sorted by pageIndex)
          const insertIndex = state.pages.findIndex((p) => p.pageIndex > page.pageIndex)
          if (insertIndex === -1) {
            state.pages.push(page)
          } else {
            state.pages.splice(insertIndex, 0, page)
          }
        })
      },

      addPageSpans: (spans) => {
        if (spans.length === 0) return
        set((state) => {
          state.spans.push(...spans)
        })
        get().updateTagMap()
      },

      addPageRegions: (regions) => set((state) => {
        if (!regions || regions.length === 0) return
        state.regions.push(...regions)
      }),

      removeSpan: (spanId) => {
        let removed = false
        set((state) => {
          const index = state.spans.findIndex((s) => s.id === spanId)
          if (index !== -1) {
            state.spans.splice(index, 1)
            if (state.selectedSpanId === spanId) {
              state.selectedSpanId = null
            }
            removed = true
          }
        })
        // Update tag map AFTER set() completes to ensure state is synchronized
        if (removed) {
          get().updateTagMap()
        }
      },

      removeRegion: (regionId) => set((state) => {
        const index = state.regions.findIndex((r) => r.id === regionId)
        if (index !== -1) {
          state.regions.splice(index, 1)
          if (state.selectedRegionId === regionId) {
            state.selectedRegionId = null
          }
        }
      }),

      removeSpansByNormalizedText: (normalizedText) => {
        let removedCount = 0
        set((state) => {
          const toRemove = state.spans.filter(
            (s) => normalizeText(s.text) === normalizedText
          )
          removedCount = toRemove.length
          if (removedCount > 0) {
            const idsToRemove = new Set(toRemove.map((s) => s.id))
            state.spans = state.spans.filter((s) => !idsToRemove.has(s.id))
            if (state.selectedSpanId && idsToRemove.has(state.selectedSpanId)) {
              state.selectedSpanId = null
            }
            // Also add to suppressed texts to prevent re-detection
            const newSuppressed = new Set(state.suppressedTexts)
            newSuppressed.add(normalizedText)
            state.suppressedTexts = newSuppressed
          }
        })
        if (removedCount > 0) {
          get().updateTagMap()
        }
        return removedCount
      },

      findSpansByNormalizedText: (normalizedText) => {
        return get().spans.filter(
          (s) => normalizeText(s.text) === normalizedText
        )
      },

      updateSpanLabel: (spanId, label) => {
        let updated = false
        set((state) => {
          const span = state.spans.find((s) => s.id === spanId)
          if (span) {
            span.label = label
            updated = true
          }
        })
        // Update tag map AFTER set() completes to ensure state is synchronized
        if (updated) {
          get().updateTagMap()
        }
      },

      updateSpanBounds: (spanId, charStart, charEnd, pageText, pageTokens) => {
        let updated = false
        set((state) => {
          const span = state.spans.find((s) => s.id === spanId)
          if (span) {
            span.charStart = charStart
            span.charEnd = charEnd
            span.text = pageText.slice(charStart, charEnd)
            span.normalizedText = normalizeText(span.text)
            span.tokens = findTokensInRange(pageTokens, charStart, charEnd)
            span.source = 'user'
            updated = true
          }
        })
        if (updated) {
          get().updateTagMap()
        }
      },

      updateRegionLabel: (regionId, label) => set((state) => {
        const region = state.regions.find((r) => r.id === regionId)
        if (region) {
          region.label = label
        }
      }),

      updateSpanLabelByNormalizedText: (normalizedText, label) => {
        let updatedCount = 0
        set((state) => {
          const toUpdate = state.spans.filter(
            (s) => normalizeText(s.text) === normalizedText
          )
          updatedCount = toUpdate.length
          for (const span of toUpdate) {
            span.label = label
          }
          if (updatedCount > 0) {
            // Also set label override for future pages
            const newOverrides = new Map(state.labelOverrides)
            newOverrides.set(normalizedText, label)
            state.labelOverrides = newOverrides
          }
        })
        if (updatedCount > 0) {
          get().updateTagMap()
        }
        return updatedCount
      },

      suppressText: (normalizedText) => set((state) => {
        const newSuppressed = new Set(state.suppressedTexts)
        newSuppressed.add(normalizedText)
        state.suppressedTexts = newSuppressed
      }),

      setLabelOverride: (normalizedText, label) => set((state) => {
        const newOverrides = new Map(state.labelOverrides)
        newOverrides.set(normalizedText, label)
        state.labelOverrides = newOverrides
      }),

      setForcedLabel: (normalizedText, label) => set((state) => {
        const newForced = new Map(state.forcedLabels)
        newForced.set(normalizedText, label)
        state.forcedLabels = newForced
      }),

      removeSuppressedText: (normalizedText) => set((state) => {
        const next = new Set(state.suppressedTexts)
        next.delete(normalizedText)
        state.suppressedTexts = next
      }),

      removeLabelOverride: (normalizedText) => set((state) => {
        const next = new Map(state.labelOverrides)
        next.delete(normalizedText)
        state.labelOverrides = next
      }),

      removeForcedLabel: (normalizedText) => set((state) => {
        const next = new Map(state.forcedLabels)
        next.delete(normalizedText)
        state.forcedLabels = next
      }),

      setSelectedSpan: (spanId) => set((state) => {
        state.selectedSpanId = spanId
      }),

      setSelectedRegion: (regionId) => set((state) => {
        state.selectedRegionId = regionId
      }),

      setConfidenceThreshold: (threshold) => set((state) => {
        state.confidenceThreshold = threshold
      }),

      setZoom: (zoom) => set((state) => {
        state.zoom = Math.max(0.25, Math.min(3, zoom))
      }),

      setCurrentPage: (page) => set((state) => {
        state.currentPage = Math.max(0, Math.min(page, state.pages.length - 1))
      }),

      setDirty: (dirty) => set((state) => {
        state.isDirty = dirty
      }),

      setProcessing: (progress) => set((state) => {
        state.processing = progress
      }),

      setModelsReady: (ready) => set((state) => {
        state.modelsReady = ready
      }),

      setModelLoadingProgress: (model, progress) => set((state) => {
        state.modelLoadingProgress[model] = progress
      }),

      setTotalPageCount: (count) => set((state) => {
        state.totalPageCount = count
      }),

      setPageProcessingStatus: (pageIndex, status) => set((state) => {
        // Create a new Map to ensure Zustand detects the change
        const newMap = new Map(state.pageProcessingStatus)
        newMap.set(pageIndex, status)
        state.pageProcessingStatus = newMap
      }),

      updateTagMap: () => set((state) => {
        const newTagMap = new Map<string, TagEntry>()
        const labelCounters = new Map<EntityLabel, number>()

        // Sort spans by page and position for consistent ordering
        const sortedSpans = [...state.spans].sort((a, b) => {
          if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex
          return a.charStart - b.charStart
        })

        for (const span of sortedSpans) {
          const normalized = normalizeText(span.text)

          if (!newTagMap.has(normalized)) {
            // Get next counter for this label
            const counter = (labelCounters.get(span.label) || 0) + 1
            labelCounters.set(span.label, counter)

            newTagMap.set(normalized, {
              tag: generateTag(span.label, counter),
              label: span.label,
              originalTexts: new Set([span.text]),
              count: 1,
            })
          } else {
            const entry = newTagMap.get(normalized)!
            entry.originalTexts.add(span.text)
            entry.count++
          }
        }

        state.tagMap = newTagMap
      }),

      setCorpusRules: (rules) => set((state) => {
        state.suppressedTexts = rules.suppressedTexts
        state.labelOverrides = rules.labelOverrides
        state.forcedLabels = rules.forcedLabels
      }),

      reset: () => set((state) => {
        state.file = null
        state.pages = []
        state.spans = []
        state.regions = []
        state.tagMap = new Map()
        state.selectedSpanId = null
        state.selectedRegionId = null
        state.confidenceThreshold = 0.5
        state.zoom = 1
        state.currentPage = 0
        state.processing = { stage: 'idle', progress: 0, message: '' }
        state.isDirty = false
        // Don't reset modelsReady or modelLoadingProgress - models stay loaded
        state.pageProcessingStatus = new Map()
        state.totalPageCount = 0
        state.loadedDocumentId = null
      }),
    })),
      {
        // Only track changes to spans for undo/redo
        partialize: (state) => ({
          spans: state.spans,
        }),
        limit: 50,
      }
    ),
    persistConfig
  )
)

// Selector hooks for better performance
export const useSpans = () => useStore((state) => state.spans)
export const usePages = () => useStore((state) => state.pages)
export const useProcessing = () => useStore((state) => state.processing)
export const useSelectedSpanId = () => useStore((state) => state.selectedSpanId)
export const useConfidenceThreshold = () => useStore((state) => state.confidenceThreshold)
export const useZoom = () => useStore((state) => state.zoom)
export const useTagMap = () => useStore((state) => state.tagMap)

// Get filtered spans based on confidence threshold
export const useFilteredSpans = () => {
  const spans = useStore((state) => state.spans)
  const threshold = useStore((state) => state.confidenceThreshold)
  return spans.filter((span) => span.confidence >= threshold)
}

// Get spans for a specific page
export const usePageSpans = (pageIndex: number) => {
  const spans = useStore((state) => state.spans)
  const threshold = useStore((state) => state.confidenceThreshold)
  return spans.filter(
    (span) => span.pageIndex === pageIndex && span.confidence >= threshold
  )
}

// Get instance count for a normalized text
export const getInstanceCount = (normalizedText: string) => {
  const spans = useStore.getState().spans
  return spans.filter((s) => normalizeText(s.text) === normalizedText).length
}

// Model loading selectors
export const useModelsReady = () => useStore((state) => state.modelsReady)
export const useModelLoadingProgress = () => useStore((state) => state.modelLoadingProgress)

// User decision selectors
export const useSuppressedTexts = () => useStore((state) => state.suppressedTexts)
export const useLabelOverrides = () => useStore((state) => state.labelOverrides)

// Page processing selectors
export const usePageProcessingStatus = () => useStore((state) => state.pageProcessingStatus)
export const useTotalPageCount = () => useStore((state) => state.totalPageCount)
export const useCurrentPage = () => useStore((state) => state.currentPage)

// Auth selectors
export const useIsAuthenticated = () => useStore((state) => state.isAuthenticated)
export const useUser = () => useStore((state) => state.user)
export const useToken = () => useStore((state) => state.token)

// Document loading selectors
export const useLoadedDocumentId = () => useStore((state) => state.loadedDocumentId)

// Saved documents selectors (browser-only mode)
export const useSavedDocuments = () => useStore((state) => state.savedDocuments)

// Undo/redo helpers
export const useTemporalStore = () => useStore.temporal

export const undo = () => useStore.temporal.getState().undo()
export const redo = () => useStore.temporal.getState().redo()
export const canUndo = () => useStore.temporal.getState().pastStates.length > 0
export const canRedo = () => useStore.temporal.getState().futureStates.length > 0
