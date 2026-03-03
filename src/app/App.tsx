import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, useBlocker, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { DetectedSpan, EntityLabel, RedactionRegion } from '../types'
import { normalizeEntityLabel } from '../types'
import { useStore, getInstanceCount, normalizeText } from '../state/store'
import { loadPdf } from '../pdf/pdfLoader'
import { propagateEntities } from '../ner/propagate'
import { getKnownFalsePositiveTexts } from '../ner/knownFalsePositives'
import { createSpan } from '../tagging/applyEdits'
import { useModelLoader } from '../hooks/useModelLoader'
import { processDocumentProgressively } from '../processing/pageProcessor'
import type { ResumeOptions } from '../processing/pageProcessor'
import { ocrClient } from '../ocr/ocrClient'
import { storePdf, loadPdf as loadStoredPdf, clearPdf, arrayBufferToFile } from '../state/pdfPersistence'
import {
  deleteDocumentData,
  deleteDocumentMeta,
  getDocumentData,
  loadAllDocumentMetas,
  loadCorpusRules,
  putDocumentData,
  saveCorpusRules,
  upsertDocumentMeta,
} from '../state/documentsPersistence'
import { ProcessingOverlay } from '../components/ProcessingOverlay'
import { PaginatedPdfViewer } from '../components/PaginatedPdfViewer'
import { Sidebar } from '../components/Sidebar'
import { Toolbar } from '../components/Toolbar'
import { EditorHelpDialog } from '../components/EditorHelpDialog'
import { SelectTextHint } from '../components/SelectTextHint'

export default function App() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [restoringPdf, setRestoringPdf] = useState(false)
  const [loadingDocument, setLoadingDocument] = useState(false)
  const [processingFromLocationState, setProcessingFromLocationState] = useState(false)
  const [showEditorHelp, setShowEditorHelp] = useState(false)
  const [previewAnonymized, setPreviewAnonymized] = useState(false)
  const [selectionMode, setSelectionMode] = useState<'token' | 'box'>('token')
  const [showSelectHint, setShowSelectHint] = useState(
    () => (typeof window !== 'undefined' ? !localStorage.getItem('lbo-anonymizer-select-hint-dismissed') : true)
  )
  const hasTriedRestore = useRef(false)
  const hasTriedLoadDocument = useRef(false)
  const hasProcessedLocationState = useRef(false)
  const hasShownHelpThisSession = useRef(false)
  /** Session id for the current document processing; callbacks ignore work if it no longer matches (e.g. user switched document). */
  const processingSessionIdRef = useRef<string | null>(null)

  // Model loading hook (loads OCR + NER on app mount)
  // Note: modelsReady and modelLoadingProgress are used in the upload modal on DocumentListPage
  useModelLoader()

  // Store state
  const file = useStore((state) => state.file)
  const pages = useStore((state) => state.pages)
  const spans = useStore((state) => state.spans)
  const regions = useStore((state) => state.regions)
  const selectedSpanId = useStore((state) => state.selectedSpanId)
  const selectedRegionId = useStore((state) => state.selectedRegionId)
  const confidenceThreshold = useStore((state) => state.confidenceThreshold)
  const zoom = useStore((state) => state.zoom)
  const processing = useStore((state) => state.processing)
  const currentPage = useStore((state) => state.currentPage)
  const pageProcessingStatus = useStore((state) => state.pageProcessingStatus)
  const totalPageCount = useStore((state) => state.totalPageCount)
  const loadedDocumentId = useStore((state) => state.loadedDocumentId)
  const isDirty = useStore((state) => state.isDirty)
  const savedDocuments = useStore((state) => state.savedDocuments)
  const getSavedDocument = useStore((state) => state.getSavedDocument)
  const setSavedDocuments = useStore((state) => state.setSavedDocuments)
  const addSavedDocument = useStore((state) => state.addSavedDocument)
  const updateSavedDocument = useStore((state) => state.updateSavedDocument)

  // Store actions
  const setFile = useStore((state) => state.setFile)
  const setPages = useStore((state) => state.setPages)
  const setSpans = useStore((state) => state.setSpans)
  const setRegions = useStore((state) => state.setRegions)
  const addSpan = useStore((state) => state.addSpan)
  const addSpans = useStore((state) => state.addSpans)
  const addPage = useStore((state) => state.addPage)
  const addPageSpans = useStore((state) => state.addPageSpans)
  const addPageRegions = useStore((state) => state.addPageRegions)
  const removeSpan = useStore((state) => state.removeSpan)
  const removeRegion = useStore((state) => state.removeRegion)
  const removeSpansByNormalizedText = useStore((state) => state.removeSpansByNormalizedText)
  const updateSpanLabel = useStore((state) => state.updateSpanLabel)
  const updateSpanBounds = useStore((state) => state.updateSpanBounds)
  const updateRegionLabel = useStore((state) => state.updateRegionLabel)
  const setSelectedSpan = useStore((state) => state.setSelectedSpan)
  const setSelectedRegion = useStore((state) => state.setSelectedRegion)
  const setConfidenceThreshold = useStore((state) => state.setConfidenceThreshold)
  const setProcessing = useStore((state) => state.setProcessing)
  const setCurrentPage = useStore((state) => state.setCurrentPage)
  const setTotalPageCount = useStore((state) => state.setTotalPageCount)
  const setPageProcessingStatus = useStore((state) => state.setPageProcessingStatus)
  const setLoadedDocumentId = useStore((state) => state.setLoadedDocumentId)
  const suppressText = useStore((state) => state.suppressText)
  const setLabelOverride = useStore((state) => state.setLabelOverride)
  const setForcedLabel = useStore((state) => state.setForcedLabel)
  const setDirty = useStore((state) => state.setDirty)
  const setCorpusRules = useStore((state) => state.setCorpusRules)
  const reset = useStore((state) => state.reset)

  // Toggle language
  const toggleLanguage = useCallback(() => {
    const newLang = i18n.language === 'fr' ? 'en' : 'fr'
    i18n.changeLanguage(newLang)
  }, [i18n])

  // Hydrate local persistence (documents list + corpus rules) from IndexedDB
  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      try {
        const [metas, rules] = await Promise.all([
          loadAllDocumentMetas(),
          loadCorpusRules(),
        ])

        if (cancelled) return

        setSavedDocuments(metas)
        setCorpusRules({
          suppressedTexts: new Set(rules.suppressedTexts),
          labelOverrides: new Map(
            rules.labelOverrides.map(([k, v]) => [k, normalizeEntityLabel(v as string)])
          ),
          forcedLabels: new Map(
            rules.forcedLabels.map(([k, v]) => [k, normalizeEntityLabel(v as string)])
          ),
        })
      } catch (e) {
        console.error('[App] Failed to hydrate from IndexedDB:', e)
      }
    }

    hydrate()
    return () => {
      cancelled = true
    }
  }, [setSavedDocuments, setCorpusRules])

  // Show editor help popup when entering editor with a loaded document
  useEffect(() => {
    if (hasShownHelpThisSession.current) return
    if (!pdfDocument) return
    if (pages.length === 0) return
    if (processing.stage !== 'ready') return

    const dismissed = localStorage.getItem('lbo-anonymizer-editor-help-dismissed') === '1'
    if (!dismissed) {
      setShowEditorHelp(true)
    }
    hasShownHelpThisSession.current = true
  }, [pdfDocument, pages.length, processing.stage])

  // Warn user before closing/refreshing when document is loaded
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = '' // Required for Chrome
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // Block in-app navigation when document is loaded (using React Router's useBlocker)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty &&
      currentLocation.pathname !== nextLocation.pathname &&
      // Allow navigation to /documents after confirm (handled by handleConfirmAnonymisation)
      !nextLocation.pathname.startsWith('/documents')
  )

  // Show confirmation dialog for blocked navigation
  useEffect(() => {
    if (blocker.state === 'blocked') {
      const confirmed = window.confirm(t('editor.unsavedChangesWarning'))
      if (confirmed) {
        blocker.proceed()
      } else {
        blocker.reset()
      }
    }
  }, [blocker, t])

  // Restore PDF from IndexedDB on mount (if we have persisted pages but no file/document)
  useEffect(() => {
    // Only try once, and only if we have persisted state but no file
    if (hasTriedRestore.current) return
    if (file) return // Already have a file
    if (pages.length === 0) return // No persisted state to restore

    // Skip restoration if a document is being loaded via URL param or navigation state —
    // those flows call reset() + load the correct document themselves.
    // Without this guard, restorePdfFromStorage races with loadDocumentFromStore /
    // processFile and can overwrite the new document's state with stale sessionStorage data.
    if (searchParams.get('documentId')) return
    if ((location.state as { file?: File } | null)?.file) return

    hasTriedRestore.current = true

    const restorePdfFromStorage = async () => {
      setRestoringPdf(true)
      try {
        const stored = await loadStoredPdf()
        if (stored) {
          // Re-check: another effect may have set a file while we awaited IndexedDB
          if (useStore.getState().file) {
            console.log('[App] Skipping PDF restore — file already set by another effect')
            return
          }

          console.log('[App] Restoring PDF from IndexedDB:', stored.filename)

          // Convert ArrayBuffer to File
          const restoredFile = arrayBufferToFile(stored.data, stored.filename)
          setFile(restoredFile)

          // Load PDF document for viewer
          const { document } = await loadPdf(restoredFile)
          setPdfDocument(document)

          // Mark as ready since we have persisted state
          setProcessing({ stage: 'ready', progress: 100, message: 'Restored from storage' })
        } else {
          // No stored PDF but we have pages - this shouldn't happen, clear state
          console.log('[App] No stored PDF found but have pages, clearing state')
          reset()
        }
      } catch (error) {
        console.error('[App] Failed to restore PDF:', error)
        // Clear inconsistent state
        reset()
      } finally {
        setRestoringPdf(false)
      }
    }

    restorePdfFromStorage()
  }, [file, pages.length, searchParams, location.state, setFile, setProcessing, reset])

  // Load document from saved documents when documentId is in URL
  useEffect(() => {
    const documentIdParam = searchParams.get('documentId')
    if (!documentIdParam) return

    // Skip if already loading or if already loaded this document
    if (hasTriedLoadDocument.current && loadedDocumentId === documentIdParam) return
    if (loadingDocument) return

    hasTriedLoadDocument.current = true

    const loadDocumentFromStore = async () => {
      setLoadingDocument(true)
      setProcessing({
        stage: 'loading-pdf',
        progress: 0,
        message: t('processing.loadingPdfMessage'),
      })

      try {
        // Fetch document meta (optional; used for filename)
        const savedMeta = getSavedDocument(documentIdParam)
          ?? (await loadAllDocumentMetas()).find((m) => m.id === documentIdParam)

        setProcessing({
          stage: 'loading-pdf',
          progress: 20,
          message: t('processing.loadingPdfMessage'),
        })

        // Load document data from IndexedDB (never rerun pipeline on View)
        const savedData = await getDocumentData(documentIdParam)
        if (!savedData) throw new Error('Document data not found')

        setProcessing({
          stage: 'loading-pdf',
          progress: 40,
          message: t('processing.loadingPdfMessage'),
        })

        // Load PDF document for viewer
        const { document: pdfDoc, numPages } = await loadPdf(savedData.pdfData)

        // Parse pages/entities from JSON
        const storedPages = JSON.parse(savedData.pagesJson || '[]') as typeof pages
        const entities = JSON.parse(savedData.entitiesJson || '[]') as DetectedSpan[]
        const storedRegions = JSON.parse(savedData.regionsJson || '[]') as RedactionRegion[]

        // Create a File object for the store
        const originalName = savedMeta?.originalFilename ?? 'document.pdf'
        const pdfFile = new File([savedData.pdfData], originalName, { type: 'application/pdf' })

        const isDraft = savedMeta?.isDraft ?? false

        // Normalize persisted state: dedupe/sort pages by pageIndex, filter to valid range [0, numPages-1]
        const rawPages = Array.isArray(storedPages) ? storedPages : []
        const validPageIndices = new Set(
          rawPages
            .filter((p: { pageIndex?: number }) => typeof p?.pageIndex === 'number' && p.pageIndex >= 0 && p.pageIndex < numPages)
            .map((p: { pageIndex: number }) => p.pageIndex)
        )
        const parsedPages: typeof pages = rawPages
          .filter((p: { pageIndex?: number }) => validPageIndices.has(p?.pageIndex ?? -1))
          .reduce((acc: typeof pages, p: (typeof pages)[0]) => {
            if (acc.some((existing) => existing.pageIndex === p.pageIndex)) return acc
            acc.push(p)
            return acc
          }, [] as typeof pages)
          .sort((a, b) => a.pageIndex - b.pageIndex)

        const rawEntities = Array.isArray(entities)
          ? entities.map((s) => ({ ...s, label: normalizeEntityLabel(s.label) }))
          : []
        const normalizedEntities = rawEntities.filter(
          (s) => typeof s.pageIndex === 'number' && s.pageIndex >= 0 && s.pageIndex < numPages
        )

        const rawRegions = Array.isArray(storedRegions)
          ? storedRegions.map((r) => ({ ...r, label: normalizeEntityLabel(r.label) }))
          : []
        const normalizedRegions = rawRegions.filter(
          (r) => typeof r.pageIndex === 'number' && r.pageIndex >= 0 && r.pageIndex < numPages
        )

        // Resume from the first index not yet present (max present pageIndex + 1), not from array length
        const maxPresentPageIndex = parsedPages.length === 0 ? -1 : Math.max(...parsedPages.map((p) => p.pageIndex))
        const resumeFromPage = isDraft ? Math.min(maxPresentPageIndex + 1, numPages) : numPages

        // Reject any in-flight OCR from a previous document so results are not applied to this one
        ocrClient.rejectAllPending()

        // Reset state and hydrate saved data
        reset()
        setFile(pdfFile)
        setPdfDocument(pdfDoc)
        setLoadedDocumentId(documentIdParam)

        // Store as in-progress PDF for refresh resilience
        try {
          await storePdf(savedData.pdfData, originalName)
        } catch (e) {
          console.warn('[App] Failed to persist PDF to IndexedDB:', e)
        }

        setPages(parsedPages)
        setSpans(normalizedEntities)
        setRegions(normalizedRegions)

        if (isDraft && resumeFromPage < numPages) {
          // Draft with remaining pages: show full PDF, mark saved pages ready by actual pageIndex,
          // queue remaining pages as pending, then resume processing in background.
          setDirty(true)
          setTotalPageCount(numPages)
          for (let i = 0; i < numPages; i++) {
            setPageProcessingStatus(i, validPageIndices.has(i) ? 'ready' : 'pending')
          }

          // Clear URL param before kicking off background work
          setSearchParams({}, { replace: true })

          const resumePdfBuffer = savedData.pdfData
          const resumeOptions: ResumeOptions = {
            startPage: resumeFromPage,
            seedPages: parsedPages,
            seedSpans: normalizedEntities,
          }

          const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
          processingSessionIdRef.current = sessionId

          // Fire-and-forget: resume processing remaining pages
          processDocumentProgressively(pdfDoc, numPages, {
            onPageStart: (pageIndex) => {
              if (processingSessionIdRef.current !== sessionId) return
              setPageProcessingStatus(pageIndex, 'processing')
            },
            onOcrProgress: () => {},
            onPageComplete: (pageIndex, result) => {
              if (processingSessionIdRef.current !== sessionId) return
              addPage(result.pageModel)
              addPageSpans(result.spans)
              addPageRegions(result.regions)
              setPageProcessingStatus(pageIndex, 'ready')

              // Auto-save draft every 10 pages
              if ((pageIndex + 1) % 10 === 0) {
                if (processingSessionIdRef.current !== sessionId) return
                const s = useStore.getState()
                const now = new Date().toISOString()
                const draftMeta = {
                  id: documentIdParam,
                  filename: savedMeta?.filename ?? originalName,
                  originalFilename: originalName,
                  pageCount: s.pages.length,
                  entityCount: s.spans.length,
                  createdAt: savedMeta?.createdAt ?? now,
                  updatedAt: now,
                  isDraft: true,
                }
                putDocumentData(documentIdParam, {
                  pdfData: resumePdfBuffer,
                  pagesJson: JSON.stringify(s.pages),
                  entitiesJson: JSON.stringify(s.spans),
                  regionsJson: JSON.stringify(s.regions),
                })
                  .then(() => upsertDocumentMeta(draftMeta))
                  .then(() => addSavedDocument(draftMeta))
                  .catch(e => console.warn('[App] Draft resume auto-save failed:', e))
              }
            },
            onPageError: (pageIndex, error) => {
              if (processingSessionIdRef.current !== sessionId) return
              console.error(`Error resuming page ${pageIndex}:`, error)
              setPageProcessingStatus(pageIndex, 'error')
            },
            onFirstPageReady: () => {
              if (processingSessionIdRef.current !== sessionId) return
              setProcessing({ stage: 'ready', progress: 100, message: '' })
            },
            onAllPagesComplete: (allSpans, allPages) => {
              if (processingSessionIdRef.current !== sessionId) return
              const finalPropagated = propagateEntities(allSpans, allPages)
              if (finalPropagated.length > 0) {
                addSpans(finalPropagated)
              }
            },
          }, () => ({
            suppressedTexts: new Set([...getKnownFalsePositiveTexts(), ...useStore.getState().suppressedTexts]),
            labelOverrides: useStore.getState().labelOverrides,
            forcedLabels: useStore.getState().forcedLabels,
          }), resumeOptions).catch(e => console.error('[App] Draft resume failed:', e))

        } else {
          // Fully processed document (or fully-processed draft): show as-is
          setDirty(false)
          setTotalPageCount(resumeFromPage)
          for (let i = 0; i < resumeFromPage; i++) {
            setPageProcessingStatus(i, 'ready')
          }
          setProcessing({ stage: 'ready', progress: 100, message: '' })

          // Clear the URL param to avoid reloading
          setSearchParams({}, { replace: true })
        }

      } catch (error) {
        console.error('[App] Failed to load document from store:', error)
        setProcessing({
          stage: 'idle',
          progress: 0,
          message: '',
        })
        // Navigate back to documents on error
        navigate('/documents')
      } finally {
        setLoadingDocument(false)
      }
    }

    loadDocumentFromStore()
  }, [searchParams, loadedDocumentId, loadingDocument, setProcessing, setFile, setPages, setSpans, setTotalPageCount, setPageProcessingStatus, setLoadedDocumentId, setSearchParams, navigate, reset, getSavedDocument, setDirty, addPage, addPageSpans, addPageRegions, addSpans, addSavedDocument, t])

  // Process a PDF file progressively
  const processFile = useCallback(async (selectedFile: File) => {
    // Delete any abandoned draft before resetting — but only if pages are actually
    // loaded in this session. If loadedDocumentId was merely rehydrated from
    // sessionStorage after a refresh (pages.length === 0), we must not delete it.
    const prevState = useStore.getState()
    const prevDraftId = prevState.loadedDocumentId
    if (prevDraftId && prevState.pages.length > 0) {
      const prevMeta = prevState.getSavedDocument(prevDraftId)
      if (prevMeta?.isDraft) {
        deleteDocumentData(prevDraftId).catch(() => {})
        deleteDocumentMeta(prevDraftId).catch(() => {})
        prevState.removeSavedDocument(prevDraftId)
      }
    }

    // Reject any in-flight OCR from a previous document so results are not applied to this one
    ocrClient.rejectAllPending()

    // New document: clear previous editor state and assign draft ID immediately
    reset()
    const draftId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setLoadedDocumentId(draftId)
    setDirty(true)
    setFile(selectedFile)

    try {
      // Load PDF
      setProcessing({
        stage: 'loading-pdf',
        progress: 0,
        message: t('processing.loadingPdfMessage'),
      })

      const { document, numPages } = await loadPdf(selectedFile, (progress) => {
        setProcessing({
          stage: 'loading-pdf',
          progress,
          message: t('processing.loadingPdfMessage'),
        })
      })

      setPdfDocument(document)
      setTotalPageCount(numPages)

      // Store PDF in IndexedDB for persistence; keep reference for draft auto-saves
      let pdfArrayBuffer: ArrayBuffer | null = null
      try {
        pdfArrayBuffer = await selectedFile.arrayBuffer()
        await storePdf(pdfArrayBuffer, selectedFile.name)
      } catch (e) {
        console.warn('[App] Failed to persist PDF to IndexedDB:', e)
      }

      // Initialize all pages as 'pending'
      for (let i = 0; i < numPages; i++) {
        setPageProcessingStatus(i, 'pending')
      }

      // Set initial processing state
      setProcessing({
        stage: 'running-ocr',
        progress: 0,
        message: t('processing.runningOcrMessage', { page: 1 }),
      })

      // Track whether first page is ready (to stop showing overlay)
      let firstPageReady = false

      const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      processingSessionIdRef.current = sessionId

      // Process document progressively
      await processDocumentProgressively(document, numPages, {
        onPageStart: (pageIndex) => {
          if (processingSessionIdRef.current !== sessionId) return
          setPageProcessingStatus(pageIndex, 'processing')
          // Only update overlay for page 0
          if (pageIndex === 0) {
            setProcessing({
              stage: 'running-ocr',
              progress: 0,
              message: t('processing.runningOcrMessage', { page: 1 }),
            })
          }
        },

        onOcrProgress: (pageIndex, progress) => {
          if (processingSessionIdRef.current !== sessionId) return
          // Only show OCR progress for page 0
          if (pageIndex === 0 && !firstPageReady) {
            setProcessing({
              stage: 'running-ocr',
              progress: Math.round(progress * 0.8), // OCR is ~80% of page processing
              message: t('processing.runningOcrMessage', { page: 1 }),
            })
          }
        },

        onPageComplete: (pageIndex, result) => {
          if (processingSessionIdRef.current !== sessionId) return
          // Add page model to store
          addPage(result.pageModel)

          // Add spans for this page
          addPageSpans(result.spans)

          // Add redaction regions (e.g., signature widgets) for this page
          addPageRegions(result.regions)

          // Mark page as ready
          setPageProcessingStatus(pageIndex, 'ready')

          // Auto-save draft every 10 pages (fire-and-forget)
          if (pdfArrayBuffer && (pageIndex + 1) % 10 === 0) {
            if (processingSessionIdRef.current !== sessionId) return
            const s = useStore.getState()
            const now = new Date().toISOString()
            const draftMeta = {
              id: draftId,
              filename: selectedFile.name,
              originalFilename: selectedFile.name,
              pageCount: s.pages.length,
              entityCount: s.spans.length,
              createdAt: now,
              updatedAt: now,
              isDraft: true,
            }
            putDocumentData(draftId, {
              pdfData: pdfArrayBuffer,
              pagesJson: JSON.stringify(s.pages),
              entitiesJson: JSON.stringify(s.spans),
              regionsJson: JSON.stringify(s.regions),
            })
              .then(() => upsertDocumentMeta(draftMeta))
              .then(() => addSavedDocument(draftMeta))
              .catch(e => console.warn('[App] Draft auto-save failed:', e))
          }
        },

        onPageError: (pageIndex, error) => {
          if (processingSessionIdRef.current !== sessionId) return
          console.error(`Error processing page ${pageIndex}:`, error)
          setPageProcessingStatus(pageIndex, 'error')
        },

        onFirstPageReady: () => {
          if (processingSessionIdRef.current !== sessionId) return
          firstPageReady = true
          // User can now see and interact with first page
          setProcessing({
            stage: 'ready',
            progress: 100,
            message: '',
          })
        },

        onAllPagesComplete: (allSpans, allPages) => {
          if (processingSessionIdRef.current !== sessionId) return
          // Run final cross-page propagation to find entities from later pages on earlier pages
          const finalPropagated = propagateEntities(allSpans, allPages)

          if (finalPropagated.length > 0) {
            addSpans(finalPropagated)
          }
        },
      }, () => ({
        // Return current user decisions for each page processing
        suppressedTexts: new Set([...getKnownFalsePositiveTexts(), ...useStore.getState().suppressedTexts]),
        labelOverrides: useStore.getState().labelOverrides,
        forcedLabels: useStore.getState().forcedLabels,
      }))
    } catch (error) {
      console.error('Error processing file:', error)
      setProcessing({
        stage: 'idle',
        progress: 0,
        message: error instanceof Error ? error.message : 'Processing failed',
      })
    }
  }, [reset, setLoadedDocumentId, setDirty, setFile, setProcessing, setTotalPageCount, setPageProcessingStatus, addPage, addPageSpans, addSpans, addSavedDocument, t])

  // Process file from navigation state (when coming from DocumentListPage upload modal)
  useEffect(() => {
    // Check if there's a file in location state
    const stateFile = (location.state as { file?: File } | null)?.file
    if (!stateFile) return
    if (hasProcessedLocationState.current) return

    // IMMEDIATELY set processing state to prevent redirect race condition
    setProcessing({ stage: 'loading-pdf', progress: 0, message: '' })

    hasProcessedLocationState.current = true
    setProcessingFromLocationState(true)

    // Clear the state to prevent re-processing on refresh
    window.history.replaceState({}, document.title)

    // Process the file
    console.log('[App] Processing file from navigation state:', stateFile.name)
    processFile(stateFile).finally(() => {
      setProcessingFromLocationState(false)
    })
  }, [location.state, processFile, setProcessing])

  // Handle span actions
  const handleSpanClick = useCallback((span: DetectedSpan) => {
    setSelectedSpan(span.id)
  }, [setSelectedSpan])

  const handleRegionClick = useCallback((region: RedactionRegion) => {
    setSelectedRegion(region.id)
  }, [setSelectedRegion])

  const handleSpanRemove = useCallback((spanId: string) => {
    removeSpan(spanId)
    setDirty(true)
  }, [removeSpan, setDirty])

  const handleRegionRemove = useCallback((regionId: string) => {
    removeRegion(regionId)
    setDirty(true)
  }, [removeRegion, setDirty])

  const handleSpanLabelChange = useCallback((spanId: string, label: EntityLabel) => {
    updateSpanLabel(spanId, label)
    setDirty(true)
  }, [updateSpanLabel, setDirty])

  const handleSpanExtend = useCallback((
    spanId: string,
    charStart: number,
    charEnd: number,
    pageText: string,
    pageTokens: import('../types').Token[]
  ) => {
    updateSpanBounds(spanId, charStart, charEnd, pageText, pageTokens)
    setDirty(true)
  }, [updateSpanBounds, setDirty])

  const handleRegionLabelChange = useCallback((regionId: string, label: EntityLabel) => {
    updateRegionLabel(regionId, label)
    setDirty(true)
  }, [updateRegionLabel, setDirty])

  const handleToggleSelectionMode = useCallback(() => {
    setSelectionMode(m => m === 'token' ? 'box' : 'token')
  }, [])

  const handleRegionAdd = useCallback((pageIndex: number, bbox: import('../types').BBox, label: EntityLabel) => {
    addPageRegions([{ id: crypto.randomUUID(), pageIndex, bbox, label, source: 'user', kind: 'manual' }])
    setDirty(true)
  }, [addPageRegions, setDirty])

  // Change label for all instances of a normalized text
  const updateSpanLabelByNormalizedText = useStore((state) => state.updateSpanLabelByNormalizedText)
  const handleSpanLabelChangeAll = useCallback((normalizedText: string, label: EntityLabel) => {
    updateSpanLabelByNormalizedText(normalizedText, label)
    setDirty(true)
  }, [updateSpanLabelByNormalizedText, setDirty])

  const handleSpanAdd = useCallback((
    pageIndex: number,
    charStart: number,
    charEnd: number,
    text: string,
    label: EntityLabel
  ) => {
    const pageModel = pages.find((p) => p.pageIndex === pageIndex)
    if (!pageModel) return

    const newSpan = createSpan(text, label, pageIndex, charStart, charEnd, pageModel.tokens)
    addSpan(newSpan)
    setDirty(true)
  }, [pages, addSpan, setDirty])

  // Remove all instances of a text
  const handleRemoveAllByText = useCallback((normalizedText: string) => {
    removeSpansByNormalizedText(normalizedText)
    setDirty(true)
  }, [removeSpansByNormalizedText, setDirty])

  const persistCorpusRules = useCallback(async () => {
    const state = useStore.getState()
    await saveCorpusRules({
      suppressedTexts: Array.from(state.suppressedTexts.values()),
      labelOverrides: Array.from(state.labelOverrides.entries()),
      forcedLabels: Array.from(state.forcedLabels.entries()),
    })
  }, [])

  const collapseWhitespaceWithMap = useCallback((raw: string): { collapsedLower: string; map: number[] } => {
    let collapsed = ''
    const map: number[] = []
    let inWs = false
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]
      const isWs = /\s/.test(ch)
      if (isWs) {
        if (!inWs) {
          collapsed += ' '
          map.push(i)
          inWs = true
        }
        continue
      }
      inWs = false
      collapsed += ch
      map.push(i)
    }
    return { collapsedLower: collapsed.toLowerCase(), map }
  }, [])

  const findOccurrencesInPageText = useCallback((rawText: string, normalizedNeedle: string): Array<{ start: number; end: number }> => {
    const needle = normalizedNeedle.toLowerCase()
    if (!needle) return []
    const { collapsedLower, map } = collapseWhitespaceWithMap(rawText)
    const out: Array<{ start: number; end: number }> = []
    let searchIdx = 0
    while (true) {
      const foundIdx = collapsedLower.indexOf(needle, searchIdx)
      if (foundIdx === -1) break
      const rawStart = map[foundIdx] ?? 0
      const lastCollapsedIdx = foundIdx + needle.length - 1
      const rawLast = map[lastCollapsedIdx] ?? rawStart
      const rawEnd = Math.min(rawText.length, rawLast + 1)
      out.push({ start: rawStart, end: rawEnd })
      searchIdx = foundIdx + 1
    }
    return out
  }, [collapseWhitespaceWithMap])

  // Remove entity from all documents (whole corpus): persist rule + retroactively update saved docs
  const handleRemoveAllDocuments = useCallback((normalizedText: string) => {
    // Update current document immediately
    removeSpansByNormalizedText(normalizedText)
    suppressText(normalizedText)
    setDirty(true)

    ;(async () => {
      try {
        await persistCorpusRules()

        const now = new Date().toISOString()
        for (const meta of savedDocuments) {
          const data = await getDocumentData(meta.id)
          if (!data) continue
          const entities = JSON.parse(data.entitiesJson || '[]') as DetectedSpan[]
          const filtered = entities.filter((s) => s.normalizedText !== normalizedText)
          if (filtered.length === entities.length) continue

          await putDocumentData(meta.id, {
            ...data,
            entitiesJson: JSON.stringify(filtered),
          })

          const updatedMeta = {
            ...meta,
            entityCount: filtered.length,
            updatedAt: now,
          }
          await upsertDocumentMeta(updatedMeta)
          updateSavedDocument(updatedMeta)
        }
      } catch (e) {
        console.error('[App] Failed to apply corpus suppression:', e)
      }
    })()
  }, [removeSpansByNormalizedText, suppressText, setDirty, persistCorpusRules, savedDocuments, updateSavedDocument])

  // Change label for all documents (whole corpus): persist rule + retroactively update saved docs
  const handleSpanLabelChangeAllDocuments = useCallback((normalizedText: string, label: EntityLabel) => {
    // Update current document immediately
    updateSpanLabelByNormalizedText(normalizedText, label)
    setLabelOverride(normalizedText, label)
    setDirty(true)

    ;(async () => {
      try {
        await persistCorpusRules()

        const now = new Date().toISOString()
        for (const meta of savedDocuments) {
          const data = await getDocumentData(meta.id)
          if (!data) continue
          const entities = JSON.parse(data.entitiesJson || '[]') as DetectedSpan[]
          let changed = false
          const updated = entities.map((s) => {
            if (s.normalizedText !== normalizedText) return s
            changed = true
            return { ...s, label, source: 'user' as const }
          })
          if (!changed) continue

          await putDocumentData(meta.id, {
            ...data,
            entitiesJson: JSON.stringify(updated),
          })

          const updatedMeta = { ...meta, updatedAt: now }
          await upsertDocumentMeta(updatedMeta)
          updateSavedDocument(updatedMeta)
        }
      } catch (e) {
        console.error('[App] Failed to apply corpus label override:', e)
      }
    })()
  }, [updateSpanLabelByNormalizedText, setLabelOverride, setDirty, persistCorpusRules, savedDocuments, updateSavedDocument])

  // Find all occurrences of text in the document and create spans for them
  const handleSpanAddAll = useCallback((
    _pageIndex: number,
    _charStart: number,
    _charEnd: number,
    text: string,
    label: EntityLabel
  ) => {
    const newSpans: DetectedSpan[] = []

    // Search all pages for matching text
    for (const pageModel of pages) {
      const pageText = pageModel.text.toLowerCase()
      const searchText = text.toLowerCase()
      let searchIdx = 0

      while (true) {
        const foundIdx = pageText.indexOf(searchText, searchIdx)
        if (foundIdx === -1) break

        const foundCharStart = foundIdx
        const foundCharEnd = foundIdx + text.length

        // Skip if this exact match is already annotated
        const alreadyExists = spans.some(
          (s) =>
            s.pageIndex === pageModel.pageIndex &&
            s.charStart === foundCharStart &&
            s.charEnd === foundCharEnd
        )

        if (!alreadyExists) {
          // Get the original text with correct casing
          const originalText = pageModel.text.slice(foundCharStart, foundCharEnd)
          const newSpan = createSpan(
            originalText,
            label,
            pageModel.pageIndex,
            foundCharStart,
            foundCharEnd,
            pageModel.tokens
          )
          newSpans.push(newSpan)
        }

        searchIdx = foundIdx + 1
      }
    }

    if (newSpans.length > 0) {
      addSpans(newSpans)
      setDirty(true)
    }
  }, [pages, spans, addSpans, setDirty])

  // Manual add for whole corpus: persist forced-label rule + retroactively update saved docs
  const handleSpanAddAllDocuments = useCallback((text: string, label: EntityLabel) => {
    const normalized = normalizeText(text)
    // Apply to current document as "whole document"
    handleSpanAddAll(0, 0, 0, text, label)
    // Persist rule for future docs
    setForcedLabel(normalized, label)
    setDirty(true)

    ;(async () => {
      try {
        await persistCorpusRules()

        const now = new Date().toISOString()
        for (const meta of savedDocuments) {
          const data = await getDocumentData(meta.id)
          if (!data) continue
          const pagesParsed = JSON.parse(data.pagesJson || '[]') as typeof pages
          const entities = JSON.parse(data.entitiesJson || '[]') as DetectedSpan[]

          const existingKeys = new Set(
            entities.map((s) => `${s.pageIndex}:${s.charStart}:${s.charEnd}`)
          )

          const newSpans: DetectedSpan[] = []
          for (const pageModel of pagesParsed) {
            const occurrences = findOccurrencesInPageText(pageModel.text, normalized)
            for (const occ of occurrences) {
              const key = `${pageModel.pageIndex}:${occ.start}:${occ.end}`
              if (existingKeys.has(key)) continue
              const originalText = pageModel.text.slice(occ.start, occ.end)
              const span = createSpan(
                originalText,
                label,
                pageModel.pageIndex,
                occ.start,
                occ.end,
                pageModel.tokens
              )
              newSpans.push(span)
              existingKeys.add(key)
            }
          }

          if (newSpans.length === 0) continue

          const updatedEntities = [...entities, ...newSpans]
          await putDocumentData(meta.id, {
            ...data,
            entitiesJson: JSON.stringify(updatedEntities),
          })

          const updatedMeta = {
            ...meta,
            entityCount: updatedEntities.length,
            updatedAt: now,
          }
          await upsertDocumentMeta(updatedMeta)
          updateSavedDocument(updatedMeta)
        }
      } catch (e) {
        console.error('[App] Failed to apply corpus forced label:', e)
      }
    })()
  }, [handleSpanAddAll, setForcedLabel, setDirty, persistCorpusRules, savedDocuments, pages, findOccurrencesInPageText, updateSavedDocument])

  // Count matching occurrences of text in document
  const countTextMatches = useCallback((text: string): number => {
    const searchText = text.toLowerCase()
    let count = 0

    for (const pageModel of pages) {
      const pageText = pageModel.text.toLowerCase()
      let searchIdx = 0

      while (true) {
        const foundIdx = pageText.indexOf(searchText, searchIdx)
        if (foundIdx === -1) break
        count++
        searchIdx = foundIdx + 1
      }
    }

    return count
  }, [pages])

  // Confirm anonymisation handler - saves to Zustand store and navigates to documents
  const handleConfirmAnonymisation = useCallback(async () => {
    if (!pdfDocument || pages.length === 0) {
      console.warn('[App] Cannot confirm - missing document data', {
        pdfDocument: !!pdfDocument,
        file: !!file,
        pagesLength: pages.length
      })
      return
    }

    // Resolve file: use store's file, or derive from pdfDocument if missing (e.g. after store rehydration)
    let resolvedFile: File
    if (file) {
      resolvedFile = file
    } else {
      setProcessing({
        stage: 'loading-pdf',
        progress: 0,
        message: t('processing.uploadingDocument') || 'Saving document...',
      })
      const pdfBytes = await pdfDocument.getData()
      if (!pdfBytes?.length) {
        console.warn('[App] Cannot confirm - could not get PDF data from document')
        return
      }
      // Copy into a fresh ArrayBuffer (pdfBytes.buffer may be a SharedArrayBuffer)
      const copy = new Uint8Array(pdfBytes.byteLength)
      copy.set(pdfBytes)
      resolvedFile = new File([copy.buffer], 'document.pdf', { type: 'application/pdf' })
      setFile(resolvedFile)
    }

    console.log('[App] Confirm anonymisation clicked')

    // Show processing overlay
    setProcessing({
      stage: 'loading-pdf',
      progress: 0,
      message: t('processing.uploadingDocument') || 'Saving document...',
    })

    try {
      // Prepare entities JSON (store all spans, including user edits)
      const entitiesJson = JSON.stringify(spans)
      const regionsJson = JSON.stringify(useStore.getState().regions)

      // Prepare pages JSON (store PageModels so we don't need to re-run OCR)
      const pagesJson = JSON.stringify(pages)

      setProcessing({
        stage: 'loading-pdf',
        progress: 50,
        message: t('processing.uploadingDocument') || 'Saving document...',
      })

      // Get the PDF data as ArrayBuffer
      const pdfArrayBuffer = await resolvedFile.arrayBuffer()

      const now = new Date().toISOString()
      const docId = loadedDocumentId ?? `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const existingMeta = loadedDocumentId ? getSavedDocument(loadedDocumentId) : undefined

      // Persist full doc data to IndexedDB
      await putDocumentData(docId, {
        pdfData: pdfArrayBuffer,
        pagesJson,
        entitiesJson,
        regionsJson,
      })

      // Persist/update doc metadata to IndexedDB + store
      const meta = {
        id: docId,
        filename: existingMeta?.filename ?? resolvedFile.name,
        originalFilename: existingMeta?.originalFilename ?? resolvedFile.name,
        pageCount: pages.length,
        entityCount: spans.length,
        createdAt: existingMeta?.createdAt ?? now,
        updatedAt: now,
      }

      await upsertDocumentMeta(meta)
      updateSavedDocument(meta)

      console.log('[App] Document saved locally:', docId)

      // Clear local storage and navigate to documents
      setPdfDocument(null)
      reset()
      setLoadedDocumentId(null)
      setDirty(false)
      try {
        await clearPdf()
      } catch (e) {
        console.warn('[App] Failed to clear PDF from IndexedDB:', e)
      }

      navigate('/documents')
    } catch (error) {
      console.error('[App] Failed to save document:', error)

      // Still navigate to documents even if save fails
      setPdfDocument(null)
      reset()
      setLoadedDocumentId(null)
      setDirty(false)
      try {
        await clearPdf()
      } catch (e) {
        console.warn('[App] Failed to clear PDF from IndexedDB:', e)
      }

      navigate('/documents')
    }
  }, [pdfDocument, file, pages, spans, loadedDocumentId, getSavedDocument, reset, navigate, setProcessing, setFile, putDocumentData, upsertDocumentMeta, updateSavedDocument, setLoadedDocumentId, setDirty, t])

  // Filter spans by confidence threshold
  const filteredSpans = spans.filter((s) => s.confidence >= confidenceThreshold)

  // Check if there's a file in location state that hasn't been processed yet
  const hasLocationStateFile = !!(location.state as { file?: File } | null)?.file && !hasProcessedLocationState.current
  const hasDocumentIdParam = !!searchParams.get('documentId')

  // If no file and no pages and not waiting for file from location state, redirect to documents
  useEffect(() => {
    if (
      !file &&
      pages.length === 0 &&
      !restoringPdf &&
      !loadingDocument &&
      !hasDocumentIdParam &&
      !hasLocationStateFile &&
      !processingFromLocationState &&
      processing.stage === 'idle'
    ) {
      navigate('/documents')
    }
  }, [file, pages.length, restoringPdf, loadingDocument, hasDocumentIdParam, hasLocationStateFile, processingFromLocationState, processing.stage, navigate])

  // Show main editor
  return (
    <div className="h-screen flex flex-col bg-slate-100">
      <EditorHelpDialog
        isOpen={showEditorHelp}
        onClose={(dontShowAgain) => {
          if (dontShowAgain) {
            localStorage.setItem('lbo-anonymizer-editor-help-dismissed', '1')
          }
          setShowEditorHelp(false)
        }}
      />
      {/* Toolbar */}
      <Toolbar
        filename={((loadedDocumentId ? getSavedDocument(loadedDocumentId)?.filename : null) ?? file?.name) ?? null}
        pageCount={totalPageCount || pages.length}
        onConfirmAnonymisation={handleConfirmAnonymisation}
        onToggleLanguage={toggleLanguage}
        currentLanguage={i18n.language}
        previewAnonymized={previewAnonymized}
        onTogglePreview={() => setPreviewAnonymized(v => !v)}
        selectionMode={selectionMode}
        onToggleSelectionMode={handleToggleSelectionMode}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* PDF viewer column: hint banner + viewer */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {showSelectHint && pdfDocument && (
            <SelectTextHint
              onDismiss={() => {
                setShowSelectHint(false)
                localStorage.setItem('lbo-anonymizer-select-hint-dismissed', '1')
              }}
            />
          )}
          <div className="flex-1 overflow-hidden">
            {pdfDocument && (
              <PaginatedPdfViewer
                document={pdfDocument}
                pages={pages}
                spans={filteredSpans}
                regions={regions}
                zoom={zoom}
                totalPageCount={totalPageCount}
                pageProcessingStatus={pageProcessingStatus}
                currentPage={currentPage}
                selectedSpanId={selectedSpanId}
                selectedRegionId={selectedRegionId}
                hasMultipleDocuments={savedDocuments.length > 1}
                onPageChange={setCurrentPage}
                onSpanClick={handleSpanClick}
                onRegionClick={handleRegionClick}
                onSpanRemove={handleSpanRemove}
                onSpanRemoveAllByText={handleRemoveAllByText}
                onSpanRemoveAllDocuments={handleRemoveAllDocuments}
                onSpanLabelChange={handleSpanLabelChange}
                onSpanLabelChangeAll={handleSpanLabelChangeAll}
                onSpanLabelChangeAllDocuments={handleSpanLabelChangeAllDocuments}
                onSpanExtend={handleSpanExtend}
                onSpanAdd={handleSpanAdd}
                onSpanAddAll={handleSpanAddAll}
                onSpanAddAllDocuments={handleSpanAddAllDocuments}
                countTextMatches={countTextMatches}
                getInstanceCount={getInstanceCount}
                previewAnonymized={previewAnonymized}
                selectionMode={selectionMode}
                onRegionAdd={handleRegionAdd}
                onRegionRemove={handleRegionRemove}
                onRegionLabelChange={handleRegionLabelChange}
              />
            )}
          </div>
        </div>

        {/* Sidebar */}
        <Sidebar
          spans={spans}
          regions={regions}
          selectedSpanId={selectedSpanId}
          selectedRegionId={selectedRegionId}
          confidenceThreshold={confidenceThreshold}
          onSpanSelect={setSelectedSpan}
          onRegionSelect={setSelectedRegion}
          onSpanRemove={handleSpanRemove}
          onSpanRemoveAllByText={handleRemoveAllByText}
          onRegionRemove={handleRegionRemove}
          onPageNavigate={setCurrentPage}
          onConfidenceChange={setConfidenceThreshold}
          getInstanceCount={getInstanceCount}
          hasMultipleDocuments={savedDocuments.length > 1}
          onSpanLabelChange={handleSpanLabelChange}
          onSpanLabelChangeAll={handleSpanLabelChangeAll}
          onRegionLabelChange={handleRegionLabelChange}
          onSpanRemoveAllDocuments={handleRemoveAllDocuments}
          onSpanLabelChangeAllDocuments={handleSpanLabelChangeAllDocuments}
        />
      </div>

      {/* Processing overlay */}
      <ProcessingOverlay progress={processing} />
    </div>
  )
}
