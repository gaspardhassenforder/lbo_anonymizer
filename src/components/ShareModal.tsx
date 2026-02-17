import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { SavedDocumentMeta } from '../state/store'
import { normalizeText } from '../state/store'
import { getDocumentData } from '../state/documentsPersistence'
import { loadPdf, getPdfPage } from '../pdf/pdfLoader'
import { exportPdfAsBlob } from '../export/exportHybridPdf'
import type { DetectedSpan, TagEntry, PageModel, RedactionRegion } from '../types'
import { normalizeEntityLabel } from '../types'

const UPLOAD_URL = 'https://lbouploadovxwraxy-pdf-upload.functions.fnc.fr-par.scw.cloud'
const MAX_BASE64_SIZE = 4.5 * 1024 * 1024 // 4.5 MB

type Phase = 'questionnaire' | 'uploading' | 'result'

interface ShareModalProps {
  isOpen: boolean
  onClose: () => void
  documents: SavedDocumentMeta[]
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      // Strip the "data:...;base64," prefix
      const base64 = dataUrl.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function ShareModal({ isOpen, onClose, documents }: ShareModalProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('questionnaire')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [uploadCurrent, setUploadCurrent] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPhase('questionnaire')
      setAnswers({})
      setUploadCurrent(0)
      setUploadTotal(0)
      setError(null)
    }
  }, [isOpen])

  // Block escape during upload
  useEffect(() => {
    if (!isOpen || phase !== 'uploading') return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, phase])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (phase === 'uploading') return
      if (e.target === e.currentTarget) onClose()
    },
    [phase, onClose]
  )

  const handleSubmit = useCallback(async () => {
    setPhase('uploading')
    setError(null)
    const sessionId = crypto.randomUUID()
    const total = documents.length
    setUploadTotal(total)

    try {
      // Upload each document sequentially
      for (let i = 0; i < documents.length; i++) {
        setUploadCurrent(i + 1)
        const doc = documents[i]

        const savedData = await getDocumentData(doc.id)
        if (!savedData) throw new Error(`Document data not found: ${doc.filename}`)

        // Parse entities & regions (same logic as handleDownloadDocument)
        const rawEntities = JSON.parse(savedData.entitiesJson || '[]') as DetectedSpan[]
        const entities = rawEntities.map((s) => ({ ...s, label: normalizeEntityLabel(s.label) }))
        const rawRegions = JSON.parse(savedData.regionsJson || '[]') as RedactionRegion[]
        const regions = Array.isArray(rawRegions)
          ? rawRegions.map((r) => ({ ...r, label: normalizeEntityLabel(r.label) }))
          : []

        // Load PDF
        const { document: pdfDoc, numPages } = await loadPdf(savedData.pdfData)

        // Build page models
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
          for (let p = 0; p < numPages; p++) {
            const page = await getPdfPage(pdfDoc, p)
            const viewport = page.getViewport({ scale: 1 })
            pageModels.push({
              pageIndex: p,
              width: viewport.width,
              height: viewport.height,
              text: '',
              tokens: [],
              hasOcr: false,
            })
          }
        }

        // Build tagMap
        const tagMap = new Map<string, TagEntry>()
        entities.forEach((entity) => {
          const key = normalizeText(entity.text)
          if (!tagMap.has(key)) {
            const existingOfLabel = Array.from(tagMap.values()).filter(
              (t) => t.label === entity.label
            ).length + 1
            tagMap.set(key, {
              tag: `${entity.label}_${existingOfLabel}`,
              label: entity.label,
              originalTexts: new Set([entity.text]),
              count: 1,
            })
          } else {
            const existing = tagMap.get(key)!
            existing.originalTexts.add(entity.text)
            tagMap.set(key, { ...existing, count: existing.count + 1 })
          }
        })

        // Generate PDF blob
        const anonymizedBlob = await exportPdfAsBlob(pdfDoc, pageModels, entities, tagMap, regions)

        // Convert to base64
        const base64 = await blobToBase64(anonymizedBlob)

        // Size check
        if (base64.length > MAX_BASE64_SIZE) {
          throw new Error(t('share.tooLarge', { filename: doc.filename }))
        }

        // Upload PDF
        const filename = doc.filename.replace(/\.pdf$/i, '_anonymized.pdf')
        const resp = await fetch(UPLOAD_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            type: 'pdf',
            filename,
            data: base64,
          }),
        })
        if (!resp.ok) {
          throw new Error(`Upload failed for ${doc.filename}: ${resp.status}`)
        }
      }

      // Upload questionnaire
      setUploadCurrent(total + 1) // signal questionnaire phase
      const qResp = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          type: 'questionnaire',
          data: {
            submittedAt: new Date().toISOString(),
            answers,
          },
        }),
      })
      if (!qResp.ok) {
        throw new Error(`Questionnaire upload failed: ${qResp.status}`)
      }

      setPhase('result')
      setError(null)
    } catch (err) {
      console.error('[ShareModal] Upload error:', err)
      setPhase('result')
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }, [documents, answers, t])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl">
        {/* Close button (hidden during upload) */}
        {phase !== 'uploading' && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* ── Questionnaire phase ── */}
        {phase === 'questionnaire' && (
          <div className="px-8 py-8">
            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-emerald-100">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-slate-800">{t('share.title')}</h2>
            </div>
            <p className="text-sm text-slate-500 mb-6">{t('share.subtitle')}</p>

            {/* Question: Usage */}
            <div className="mb-6">
              <p className="text-sm font-medium text-slate-700 mb-3">{t('share.questionUsage')}</p>
              <div className="space-y-2">
                {(['internal', 'external', 'testing'] as const).map((value) => (
                  <label
                    key={value}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      answers.usage === value
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="usage"
                      value={value}
                      checked={answers.usage === value}
                      onChange={() => setAnswers((prev) => ({ ...prev, usage: value }))}
                      className="accent-emerald-600"
                    />
                    <span className="text-sm text-slate-700">
                      {t(`share.answer${value.charAt(0).toUpperCase() + value.slice(1)}`)}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
              >
                {t('share.cancel')}
              </button>
              <button
                onClick={handleSubmit}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors"
              >
                {t('share.submit')}
              </button>
            </div>
          </div>
        )}

        {/* ── Uploading phase ── */}
        {phase === 'uploading' && (
          <div className="px-8 py-12 text-center">
            {/* Spinner */}
            <div className="mx-auto mb-4 w-12 h-12 rounded-full border-4 border-slate-200 border-t-emerald-500 animate-spin" />

            <p className="text-sm font-medium text-slate-700 mb-4">
              {uploadCurrent <= uploadTotal
                ? t('share.uploading', { current: uploadCurrent, total: uploadTotal })
                : t('share.uploadingQuestionnaire')}
            </p>

            {/* Progress bar */}
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden max-w-xs mx-auto">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{
                  width: `${uploadTotal > 0 ? (Math.min(uploadCurrent, uploadTotal) / (uploadTotal + 1)) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* ── Result phase ── */}
        {phase === 'result' && (
          <div className="px-8 py-10 text-center">
            {!error ? (
              <>
                {/* Success icon */}
                <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">{t('share.successTitle')}</h3>
                <p className="text-sm text-slate-500 mb-6">{t('share.successMessage')}</p>
              </>
            ) : (
              <>
                {/* Error icon */}
                <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">{t('share.errorTitle')}</h3>
                <p className="text-sm text-slate-500 mb-6">{t('share.errorMessage')}</p>
              </>
            )}

            <div className="flex justify-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
              >
                {t('share.close')}
              </button>
              {error && (
                <button
                  onClick={() => {
                    setPhase('questionnaire')
                    setError(null)
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors"
                >
                  {t('share.retry')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
