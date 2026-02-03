import { Link } from 'react-router-dom'
import { useStore } from '../state/store'
import { useTranslation } from 'react-i18next'

export default function OCRView() {
  const { i18n } = useTranslation()
  const file = useStore((state) => state.file)
  const pages = useStore((state) => state.pages)
  const totalPageCount = useStore((state) => state.totalPageCount)
  const pageProcessingStatus = useStore((state) => state.pageProcessingStatus)

  // Toggle language
  const toggleLanguage = () => {
    const newLang = i18n.language === 'fr' ? 'en' : 'fr'
    i18n.changeLanguage(newLang)
  }

  // Count ready pages
  const readyPages = Array.from(pageProcessingStatus.values()).filter(
    (status) => status === 'ready'
  ).length

  if (!file) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-800 mb-4">OCR Text View</h1>
          <p className="text-slate-500 mb-6">
            No document uploaded. Please upload a PDF on the{' '}
            <Link to="/" className="text-primary-600 underline hover:text-primary-700">
              main page
            </Link>{' '}
            first.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-800">OCR Text Output</h1>
              <p className="text-sm text-slate-500 mt-1">Raw text extracted via Tesseract.js OCR</p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={toggleLanguage}
                className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors"
              >
                {i18n.language === 'fr' ? 'EN' : 'FR'}
              </button>
              <Link
                to="/"
                className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors"
              >
                ← Back to Editor
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Metadata Section */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Document Metadata</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-500">Filename:</span>
              <span className="ml-2 font-medium text-slate-700">{file.name}</span>
            </div>
            <div>
              <span className="text-slate-500">File Size:</span>
              <span className="ml-2 font-medium text-slate-700">
                {(file.size / 1024).toFixed(1)} KB
              </span>
            </div>
            <div>
              <span className="text-slate-500">Total Pages:</span>
              <span className="ml-2 font-medium text-slate-700">{totalPageCount}</span>
            </div>
            <div>
              <span className="text-slate-500">OCR Processed:</span>
              <span className="ml-2 font-medium text-slate-700">
                {readyPages} / {totalPageCount} pages
              </span>
            </div>
            <div>
              <span className="text-slate-500">Total Characters:</span>
              <span className="ml-2 font-medium text-slate-700">
                {pages.reduce((sum, p) => sum + p.text.length, 0).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Total Words:</span>
              <span className="ml-2 font-medium text-slate-700">
                {pages.reduce((sum, p) => sum + p.tokens.length, 0).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Processing Status */}
        {readyPages < totalPageCount && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-2 text-amber-700">
              <svg
                className="w-5 h-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span className="font-medium">
                Processing in progress... {readyPages}/{totalPageCount} pages complete
              </span>
            </div>
          </div>
        )}

        {/* Pages Content */}
        <div className="space-y-6">
          {pages.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <p className="text-slate-500">
                Waiting for OCR processing to complete...
              </p>
            </div>
          ) : (
            pages.map((page) => (
              <div
                key={page.pageIndex}
                className="bg-white rounded-xl border border-slate-200 overflow-hidden"
              >
                {/* Page Header */}
                <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <h3 className="font-semibold text-slate-800">
                      Page {page.pageIndex + 1}
                    </h3>
                    <span className="text-sm text-slate-500">
                      {page.width.toFixed(0)} × {page.height.toFixed(0)} pts
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-slate-500">
                    <span>{page.text.length.toLocaleString()} chars</span>
                    <span>{page.tokens.length.toLocaleString()} words</span>
                    {page.hasOcr && (
                      <span className="inline-flex items-center gap-1 text-success-600">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        OCR
                      </span>
                    )}
                  </div>
                </div>

                {/* Page Text Content */}
                <div className="p-6">
                  <pre className="whitespace-pre-wrap font-mono text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-lg p-4 overflow-x-auto">
                    {page.text || '(No text extracted)'}
                  </pre>
                </div>

                {/* Token Details (collapsible) */}
                <details className="border-t border-slate-100">
                  <summary className="px-6 py-3 cursor-pointer text-sm text-slate-500 hover:bg-slate-50">
                    View token details ({page.tokens.length} tokens)
                  </summary>
                  <div className="px-6 pb-4 max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-200">
                          <th className="py-2 pr-4">Token</th>
                          <th className="py-2 pr-4">Position (x, y)</th>
                          <th className="py-2 pr-4">Size (w × h)</th>
                          <th className="py-2">Char Range</th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.tokens.slice(0, 100).map((token, idx) => (
                          <tr key={token.id || idx} className="border-b border-slate-100">
                            <td className="py-1.5 pr-4 font-mono">{token.text}</td>
                            <td className="py-1.5 pr-4 text-slate-500">
                              ({token.bbox.x.toFixed(1)}, {token.bbox.y.toFixed(1)})
                            </td>
                            <td className="py-1.5 pr-4 text-slate-500">
                              {token.bbox.width.toFixed(1)} × {token.bbox.height.toFixed(1)}
                            </td>
                            <td className="py-1.5 text-slate-500">
                              {token.charStart}–{token.charEnd}
                            </td>
                          </tr>
                        ))}
                        {page.tokens.length > 100 && (
                          <tr>
                            <td colSpan={4} className="py-2 text-center text-slate-400">
                              ... and {page.tokens.length - 100} more tokens
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            ))
          )}
        </div>

        {/* Copy All Button */}
        {pages.length > 0 && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={() => {
                const allText = pages
                  .map(
                    (p) =>
                      `=== PAGE ${p.pageIndex + 1} ===\n\n${p.text}`
                  )
                  .join('\n\n')
                navigator.clipboard.writeText(allText)
                alert('All OCR text copied to clipboard!')
              }}
              className="px-6 py-3 rounded-lg bg-slate-800 text-white font-medium hover:bg-slate-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
              Copy All OCR Text
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
