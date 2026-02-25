import { useState, useCallback, useRef, DragEvent, ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'

const FUNCTION_URL = 'https://lbouploadovxwraxy-pdf-upload.functions.fnc.fr-par.scw.cloud'

type Phase = 'idle' | 'uploading' | 'done'

interface FileItem {
  file: File
  id: string
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DropPage() {
  const { t, i18n } = useTranslation()
  const [files, setFiles] = useState<FileItem[]>([])
  const [note, setNote] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((newFiles: File[]) => {
    setFiles((prev) => [
      ...prev,
      ...newFiles.map((f) => ({ file: f, id: crypto.randomUUID() })),
    ])
  }, [])

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    // Only clear when leaving the drop zone itself
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length > 0) addFiles(dropped)
  }

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files))
      e.target.value = ''
    }
  }

  const handleSubmit = async () => {
    if (files.length === 0) return
    setPhase('uploading')
    setError(null)
    const sessionId = `${crypto.randomUUID()}_whatsapp`

    try {
      // Prefix with index to guarantee unique keys in S3
      const namedFiles = files.map(({ file }, i) => ({
        file,
        s3Name: `${String(i + 1).padStart(2, '0')}_${file.name}`,
      }))

      // Step 1: Get presigned PUT URLs
      const presignResp = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get-presigned-urls',
          sessionId,
          files: namedFiles.map(({ file, s3Name }) => ({
            filename: s3Name,
            contentType: file.type || 'application/octet-stream',
          })),
        }),
      })
      if (!presignResp.ok) throw new Error(`Server error: ${presignResp.status}`)
      const { urls } = (await presignResp.json()) as {
        urls: { filename: string; uploadUrl: string }[]
      }

      setProgress({ current: 0, total: namedFiles.length })

      // Step 2: Upload each file directly to S3
      for (let i = 0; i < namedFiles.length; i++) {
        const { file, s3Name } = namedFiles[i]
        const urlEntry = urls.find((u) => u.filename === s3Name)
        if (!urlEntry) throw new Error(`No upload URL for ${file.name}`)

        const uploadResp = await fetch(urlEntry.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        })
        if (!uploadResp.ok) throw new Error(`Upload failed for ${file.name}: ${uploadResp.status}`)
        setProgress({ current: i + 1, total: namedFiles.length })
      }

      // Step 3: Upload note as metadata (stored alongside files in S3)
      await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          type: 'questionnaire',
          data: {
            note: note.trim() || null,
            files: namedFiles.map(({ file }) => file.name),
            submittedAt: new Date().toISOString(),
            source: 'drop',
          },
        }),
      })

      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setPhase('idle')
    }
  }

  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === 'fr' ? 'en' : 'fr')
  }

  const canSubmit = files.length > 0 && phase === 'idle'

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #fafafa 60%, #f0fdf4 100%)' }}>
      {/* Language toggle */}
      <div className="absolute top-4 right-4">
        <button
          onClick={toggleLanguage}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/80 border border-slate-200 text-slate-500 text-xs font-medium hover:bg-white hover:text-slate-700 transition-colors backdrop-blur-sm"
        >
          {i18n.language === 'fr' ? 'EN' : 'FR'}
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-100 mb-4">
              <svg className="w-7 h-7 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-1">{t('drop.title')}</h1>
            <p className="text-sm text-slate-500">{t('drop.subtitle')}</p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">

            {/* ── Idle / uploading phase ── */}
            {phase !== 'done' && (
              <div className="p-6 space-y-5">

                {/* Drop zone */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => inputRef.current?.click()}
                  className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-indigo-400 bg-indigo-50'
                      : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50/50'
                  }`}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileInput}
                  />
                  <div className={`p-3 rounded-xl transition-colors ${isDragging ? 'bg-indigo-100' : 'bg-slate-100'}`}>
                    <svg className={`w-6 h-6 transition-colors ${isDragging ? 'text-indigo-500' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-slate-700">
                    {isDragging ? t('drop.dropHere') : t('drop.dragOrClick')}
                  </p>
                  <p className="text-xs text-slate-400">{t('drop.anyFormat')}</p>
                </div>

                {/* File list */}
                {files.length > 0 && (
                  <ul className="space-y-2">
                    {files.map(({ file, id }) => (
                      <li key={id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                          <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                          <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>
                        </div>
                        {phase === 'idle' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); removeFile(id) }}
                            className="flex-shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Note */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('drop.noteLabel')}
                    <span className="ml-1 font-normal text-slate-400">({t('drop.optional')})</span>
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('drop.notePlaceholder')}
                    rows={3}
                    disabled={phase === 'uploading'}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder:text-slate-400 disabled:opacity-50 transition-colors"
                  />
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-red-50 border border-red-200">
                    <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                {/* Upload progress */}
                {phase === 'uploading' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">
                        {t('drop.uploading', { current: progress.current, total: progress.total })}
                      </span>
                      <span className="text-xs text-slate-400">
                        {progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                        style={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '5%' }}
                      />
                    </div>
                  </div>
                )}

                {/* Submit button */}
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-medium rounded-xl shadow-sm transition-colors text-sm"
                >
                  {phase === 'uploading' ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {t('drop.sending')}
                    </span>
                  ) : (
                    t('drop.submit', { count: files.length })
                  )}
                </button>
              </div>
            )}

            {/* ── Done phase ── */}
            {phase === 'done' && (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-slate-800 mb-1">{t('drop.successTitle')}</h2>
                <p className="text-sm text-slate-500">{t('drop.successMessage')}</p>
              </div>
            )}
          </div>

          {/* Security note */}
          {phase !== 'done' && (
            <div className="flex items-center justify-center gap-2 mt-5">
              <svg className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <p className="text-xs text-slate-400">{t('drop.securityNote')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
