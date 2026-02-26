import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { SavedDocumentMeta } from '../state/store'
import { normalizeText } from '../state/store'
import { getDocumentData } from '../state/documentsPersistence'
import { loadPdf, getPdfPage } from '../pdf/pdfLoader'
import { exportPdfAsBlob } from '../export/exportHybridPdf'
import type { DetectedSpan, TagEntry, PageModel, RedactionRegion } from '../types'
import { normalizeEntityLabel } from '../types'

const FUNCTION_URL = 'https://lbouploadovxwraxy-pdf-upload.functions.fnc.fr-par.scw.cloud'

type Phase = 'filename_review' | 'questionnaire' | 'feedback' | 'uploading' | 'result'

interface ShareModalProps {
  isOpen: boolean
  onClose: () => void
  documents: SavedDocumentMeta[]
  onRenameDocument?: (docId: string, newFilename: string) => void
}

export function ShareModal({ isOpen, onClose, documents, onRenameDocument }: ShareModalProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('filename_review')
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [editedFilenames, setEditedFilenames] = useState<Record<string, string>>({})
  const [feedbackText, setFeedbackText] = useState('')
  const [uploadCurrent, setUploadCurrent] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPhase('filename_review')
      setEditedFilenames(Object.fromEntries(documents.map(d => [d.id, d.filename])))
      setAnswers({})
      setFeedbackText('')
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

  const handleFilenameReviewContinue = useCallback(() => {
    documents.forEach(doc => {
      const edited = editedFilenames[doc.id]
      if (edited && edited.trim() && edited.trim() !== doc.filename) {
        onRenameDocument?.(doc.id, edited.trim())
      }
    })
    setPhase('questionnaire')
  }, [documents, editedFilenames, onRenameDocument])

  const handleSubmit = useCallback(async () => {
    setPhase('uploading')
    setError(null)
    const sessionId = crypto.randomUUID()
    const total = documents.length
    setUploadTotal(total)

    try {
      // Step 1: Generate all PDF blobs sequentially (avoids memory pressure)
      const generatedFiles: { filename: string; blob: Blob }[] = []
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
              (te) => te.label === entity.label
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

        const anonymizedBlob = await exportPdfAsBlob(pdfDoc, pageModels, entities, tagMap, regions)
        const base = (editedFilenames[doc.id] || doc.filename).replace(/\.pdf$/i, '').replace(/_anonymized$/i, '')
        const filename = `${base}_anonymized.pdf`
        generatedFiles.push({ filename, blob: anonymizedBlob })
      }

      // Step 2: Request presigned URLs from the function (tiny JSON request)
      const presignResp = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get-presigned-urls',
          sessionId,
          files: generatedFiles.map((f) => ({
            filename: f.filename,
            contentType: 'application/pdf',
          })),
        }),
      })
      if (!presignResp.ok) {
        throw new Error(`Failed to get upload URLs: ${presignResp.status}`)
      }
      const { urls } = (await presignResp.json()) as {
        urls: { filename: string; uploadUrl: string }[]
      }

      // Step 3: Upload each PDF directly to S3 via presigned URL (no size limit)
      for (let i = 0; i < generatedFiles.length; i++) {
        setUploadCurrent(i + 1)
        const file = generatedFiles[i]
        const urlEntry = urls.find((u) => u.filename === file.filename)
        if (!urlEntry) throw new Error(`No presigned URL for ${file.filename}`)

        const uploadResp = await fetch(urlEntry.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          body: file.blob,
        })
        if (!uploadResp.ok) {
          throw new Error(`Upload failed for ${file.filename}: ${uploadResp.status}`)
        }
      }

      // Step 4: Upload questionnaire via the function (small JSON)
      setUploadCurrent(total + 1)
      const qResp = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          type: 'questionnaire',
          data: {
            submittedAt: new Date().toISOString(),
            answers,
            feedback: feedbackText.trim() || null,
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
  }, [documents, answers, feedbackText, editedFilenames])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-xl mx-4 bg-white rounded-2xl shadow-2xl">
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

        {/* ── Filename review phase ── */}
        {phase === 'filename_review' && (
          <div className="px-8 py-8">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-xl bg-amber-100">
                <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-slate-800">{t('share.reviewFilenamesTitle')}</h2>
            </div>

            {/* Warning banner */}
            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-sm text-amber-800">{t('share.reviewFilenamesWarning')}</p>
            </div>

            <p className="text-sm text-slate-600 mb-4">{t('share.reviewFilenamesSubtitle')}</p>

            {/* Document list */}
            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
              {documents.map(doc => {
                const full = editedFilenames[doc.id] ?? doc.filename
                const base = full.replace(/\.pdf$/i, '')
                return (
                  <div key={doc.id} className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    <div className="flex flex-1 items-center border border-slate-200 rounded-lg focus-within:ring-2 focus-within:ring-amber-400 focus-within:border-amber-400 overflow-hidden">
                      <input
                        type="text"
                        value={base}
                        onChange={e => setEditedFilenames(prev => ({ ...prev, [doc.id]: e.target.value + '.pdf' }))}
                        className="flex-1 px-3 py-2 text-sm focus:outline-none"
                      />
                      <span className="px-3 py-2 text-sm text-slate-400 bg-slate-50 border-l border-slate-200 select-none">.pdf</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
              >
                {t('share.cancel')}
              </button>
              <button
                onClick={handleFilenameReviewContinue}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors"
              >
                {t('share.continue')} →
              </button>
            </div>
          </div>
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

            <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
              {/* Question 1: Investment type (majo/mino) */}
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">{t('share.questionInvestmentType')}</p>
                <div className="flex gap-2">
                  {(['majo', 'mino'] as const).map((value) => (
                    <label
                      key={value}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                        answers.investmentType === value
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="investmentType"
                        value={value}
                        checked={answers.investmentType === value}
                        onChange={() => setAnswers((prev) => ({ ...prev, investmentType: value }))}
                        className="accent-emerald-600"
                      />
                      <span className="text-sm text-slate-700">
                        {t(`share.answer${value.charAt(0).toUpperCase() + value.slice(1)}`)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Question 2: LBO number (number input) */}
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">{t('share.questionLboNumber')}</p>
                <input
                  type="number"
                  min={1}
                  value={(answers.lboNumber as string) || ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, lboNumber: e.target.value }))}
                  placeholder={t('share.lboNumberPlaceholder')}
                  className="w-32 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              {/* Question 3: Valuation range */}
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">{t('share.questionValuation')}</p>
                <div className="flex flex-wrap gap-2">
                  {(['0_50', '50_100', '100_250', '250_500', '500_1000', '1000plus'] as const).map((value) => (
                    <label
                      key={value}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                        answers.valuation === value
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="valuation"
                        value={value}
                        checked={answers.valuation === value}
                        onChange={() => setAnswers((prev) => ({ ...prev, valuation: value }))}
                        className="accent-emerald-600"
                      />
                      <span className="text-slate-700">{t(`share.answerValuation${value}`)}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Question 4: Sector (multi-select checkboxes) */}
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">{t('share.questionSector')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    'ConsumerGoods', 'Construction', 'Digital', 'Education',
                    'Health', 'BusinessServices', 'FinancialServices', 'Other',
                  ] as const).map((value) => {
                    const selected = Array.isArray(answers.sectors) && answers.sectors.includes(value)
                    return (
                      <label
                        key={value}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                          selected
                            ? 'border-emerald-500 bg-emerald-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            setAnswers((prev) => {
                              const current = Array.isArray(prev.sectors) ? prev.sectors : []
                              const next = selected
                                ? current.filter((s) => s !== value)
                                : [...current, value]
                              return { ...prev, sectors: next }
                            })
                          }
                          className="accent-emerald-600"
                        />
                        <span className="text-slate-700">{t(`share.sector${value}`)}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
              >
                {t('share.cancel')}
              </button>
              <button
                onClick={() => setPhase('feedback')}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors"
              >
                {t('share.continue')} →
              </button>
            </div>
          </div>
        )}

        {/* ── Feedback phase ── */}
        {phase === 'feedback' && (
          <div className="px-8 py-8">
            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-emerald-100">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-slate-800">{t('share.feedbackTitle')}</h2>
            </div>
            <p className="text-sm text-slate-500 mb-6">{t('share.feedbackSubtitle')}</p>

            <textarea
              value={feedbackText}
              onChange={e => setFeedbackText(e.target.value)}
              placeholder={t('share.feedbackPlaceholder')}
              rows={5}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
            />

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setPhase('questionnaire')}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
              >
                {t('share.back')}
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
