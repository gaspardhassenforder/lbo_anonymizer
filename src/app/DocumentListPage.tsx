import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useStore, SavedDocumentMeta, normalizeText } from '../state/store'
import { useModelLoader } from '../hooks/useModelLoader'
import { DocumentCard, Document } from '../components/DocumentCard'
import { UploadModal } from '../components/UploadModal'
import { loadPdf, getPdfPage } from '../pdf/pdfLoader'
import { exportPdfAsBlob } from '../export/exportHybridPdf'
import type { DetectedSpan, TagEntry, PageModel, RedactionRegion } from '../types'
import { normalizeEntityLabel } from '../types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  deleteDocumentMeta,
  deleteDocumentData,
  getDocumentData,
  loadAllDocumentMetas,
  renameDocumentMeta,
  wipeAllLocalData,
} from '../state/documentsPersistence'

// Transform SavedDocument to Document interface for DocumentCard
function toDocument(saved: SavedDocumentMeta): Document {
  return {
    id: saved.id,
    filename: saved.filename,
    originalFilename: saved.originalFilename,
    pageCount: saved.pageCount,
    entityCount: saved.entityCount,
    createdAt: saved.createdAt
  }
}

export default function DocumentListPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const user = useStore((state) => state.user)
  const logout = useStore((state) => state.logout)
  const savedDocuments = useStore((state) => state.savedDocuments)
  const setSavedDocuments = useStore((state) => state.setSavedDocuments)
  const updateSavedDocument = useStore((state) => state.updateSavedDocument)
  const removeSavedDocument = useStore((state) => state.removeSavedDocument)
  const getSavedDocument = useStore((state) => state.getSavedDocument)

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  // Model loading hook (preload models while on documents page)
  const { modelsReady, modelLoadingProgress } = useModelLoader()

  // Transform savedDocuments to Document[] for display
  const documents = savedDocuments.map(toDocument)

  // Load documents metadata from IndexedDB on mount
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const metas = await loadAllDocumentMetas()
        if (!cancelled) setSavedDocuments(metas)
      } catch (e) {
        console.error('[Documents] Failed to load documents from IndexedDB:', e)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [setSavedDocuments])

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true)
  }

  const handleConfirmLogout = useCallback(async () => {
    setIsLoggingOut(true)
    try {
      await wipeAllLocalData()
    } catch (e) {
      console.error('[Documents] Failed to wipe local data on logout:', e)
      // Continue logout anyway
    } finally {
      logout()
      navigate('/login')
      setIsLoggingOut(false)
      setShowLogoutConfirm(false)
    }
  }, [logout, navigate])

  const handleNewDocument = () => {
    setIsUploadModalOpen(true)
  }

  const handleFileSelect = (file: File) => {
    setIsUploadModalOpen(false)
    // Navigate to editor with the file in route state
    navigate('/editor', { state: { file } })
  }

  const handleViewDocument = (doc: Document) => {
    // Navigate to the editor app with the document ID as a query param
    navigate(`/editor?documentId=${doc.id}`)
  }

  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const handleDownloadDocument = useCallback(async (doc: Document) => {
    try {
      setDownloadingId(doc.id)

      // Get document meta from store
      const savedMeta = getSavedDocument(doc.id)
      if (!savedMeta) throw new Error('Document not found')

      // Load document data from IndexedDB
      const savedData = await getDocumentData(doc.id)
      if (!savedData) throw new Error('Document data not found')

      const rawEntities = JSON.parse(savedData.entitiesJson || '[]') as DetectedSpan[]
      const entities = rawEntities.map((s) => ({ ...s, label: normalizeEntityLabel(s.label) }))
      const rawRegions = JSON.parse(savedData.regionsJson || '[]') as RedactionRegion[]
      const regions = Array.isArray(rawRegions)
        ? rawRegions.map((r) => ({ ...r, label: normalizeEntityLabel(r.label) }))
        : []

      // Load PDF document from stored data
      const { document: pdfDoc, numPages } = await loadPdf(savedData.pdfData)

      // Prefer stored pages (no pipeline); fallback to minimal pages if missing
      let pageModels: PageModel[] = []
      try {
        const storedPages = JSON.parse(savedData.pagesJson || '[]')
        if (Array.isArray(storedPages) && storedPages.length > 0) {
          pageModels = storedPages as PageModel[]
        }
      } catch {
        // ignore
      }

      if (pageModels.length === 0) {
        pageModels = []
        for (let i = 0; i < numPages; i++) {
          const page = await getPdfPage(pdfDoc, i)
          const viewport = page.getViewport({ scale: 1 })
          pageModels.push({
            pageIndex: i,
            width: viewport.width,
            height: viewport.height,
            text: '',
            tokens: [],
            hasOcr: false,
          })
        }
      }

      // Build tagMap from entities
      const tagMap = new Map<string, TagEntry>()
      entities.forEach(entity => {
        const key = normalizeText(entity.text)
        if (!tagMap.has(key)) {
          const existingOfLabel = Array.from(tagMap.values())
            .filter(t => t.label === entity.label).length + 1
          tagMap.set(key, {
            tag: `${entity.label}_${existingOfLabel}`,
            label: entity.label,
            originalTexts: new Set([entity.text]),
            count: 1
          })
        } else {
          const existing = tagMap.get(key)!
          existing.originalTexts.add(entity.text)
          tagMap.set(key, { ...existing, count: existing.count + 1 })
        }
      })

      // Generate anonymized PDF
      const anonymizedBlob = await exportPdfAsBlob(
        pdfDoc,
        pageModels,
        entities,
        tagMap,
        regions
      )

      // Download
      const url = URL.createObjectURL(anonymizedBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = savedMeta.filename.replace(/\.pdf$/i, '_anonymized.pdf')
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to download document:', err)
      alert(t('documents.downloadError') || 'Failed to download document')
    } finally {
      setDownloadingId(null)
    }
  }, [getSavedDocument, t])

  const handleDeleteDocument = (doc: Document) => {
    if (!confirm(t('documents.confirmDelete'))) return
    // Remove from UI immediately
    removeSavedDocument(doc.id)
    // Remove from IndexedDB (best effort)
    deleteDocumentData(doc.id).catch((e) => console.error('[Documents] Failed to delete doc data:', e))
    deleteDocumentMeta(doc.id).catch((e) => console.error('[Documents] Failed to delete doc meta:', e))
  }

  const handleRenameDocument = useCallback(async (doc: Document, newFilename: string) => {
    const trimmed = newFilename.trim()
    if (!trimmed) return

    const meta = getSavedDocument(doc.id)
    if (!meta) return

    const updated: SavedDocumentMeta = {
      ...meta,
      filename: trimmed,
      updatedAt: new Date().toISOString(),
    }

    // Update store immediately
    updateSavedDocument(updated)

    try {
      await renameDocumentMeta(doc.id, trimmed)
    } catch (e) {
      console.error('[Documents] Failed to rename document:', e)
      alert(t('documents.renameError') || 'Failed to rename document')
    }
  }, [getSavedDocument, updateSavedDocument, t])

  const toggleLanguage = () => {
    const newLang = i18n.language === 'fr' ? 'en' : 'fr'
    i18n.changeLanguage(newLang)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-bold text-slate-800">
                LBO <span className="text-gradient">Anonymizer</span>
              </h1>
              <span className="text-xs text-slate-400 font-mono">v{__APP_VERSION__}</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {/* Language toggle */}
              <button
                onClick={toggleLanguage}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
                <span className="text-sm font-medium">{i18n.language === 'fr' ? 'FR' : 'EN'}</span>
              </button>

              {/* User menu */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100">
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="text-sm font-medium text-slate-700">{user?.username}</span>
              </div>

              {/* Logout */}
              <button
                onClick={handleLogoutClick}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="text-sm">{t('documents.logout')}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Title and action */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">{t('documents.title')}</h2>
            <p className="text-slate-500 mt-1">{t('documents.subtitle')}</p>
          </div>
          <button
            onClick={handleNewDocument}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg shadow-sm transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t('documents.loadNew')}
          </button>
        </div>

        {/* Content */}
        {documents.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-slate-800 mb-2">{t('documents.empty')}</h3>
            <p className="text-slate-500 mb-6">{t('documents.emptyHint')}</p>
            <button
              onClick={handleNewDocument}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t('documents.loadNew')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {documents.map(doc => (
              <DocumentCard
                key={doc.id}
                document={doc}
                onView={handleViewDocument}
                onDownload={handleDownloadDocument}
                onDelete={handleDeleteDocument}
                onRename={handleRenameDocument}
                isDownloading={downloadingId === doc.id}
              />
            ))}
          </div>
        )}
      </main>

      {/* Upload modal */}
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onFileSelect={handleFileSelect}
        modelsReady={modelsReady}
        modelLoadingProgress={modelLoadingProgress}
      />

      {/* Logout confirmation */}
      {showLogoutConfirm && (
        <ConfirmDialog
          title={t('logoutConfirm.title')}
          message={t('logoutConfirm.message')}
          confirmText={isLoggingOut ? t('logoutConfirm.working') : t('logoutConfirm.confirm')}
          cancelText={t('logoutConfirm.cancel')}
          confirmVariant="danger"
          onConfirm={() => {
            if (isLoggingOut) return
            void handleConfirmLogout()
          }}
          onCancel={() => {
            if (isLoggingOut) return
            setShowLogoutConfirm(false)
          }}
        />
      )}
    </div>
  )
}
