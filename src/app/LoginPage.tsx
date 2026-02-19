import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useStore } from '../state/store'

export default function LoginPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const [loading, setLoading] = useState(false)

  const storeLogin = useStore((state) => state.login)
  const isAuthenticated = useStore((state) => state.isAuthenticated)

  // Get the page to redirect to after login (default to documents list)
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/documents'

  // If already authenticated, redirect to the target page
  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true })
    }
  }, [isAuthenticated, navigate, from])

  const handleConnect = () => {
    setLoading(true)

    // Auto-login with a session token (no credentials needed for beta)
    const token = btoa(JSON.stringify({
      userId: 1,
      username: 'admin',
      exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    }))

    storeLogin({ id: 1, username: 'admin' }, token)
    navigate(from, { replace: true })
  }

  const toggleLanguage = () => {
    const newLang = i18n.language === 'fr' ? 'en' : 'fr'
    i18n.changeLanguage(newLang)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Language toggle in top right */}
      <div className="absolute top-4 right-4">
        <button
          onClick={toggleLanguage}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 hover:border-slate-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
          {i18n.language === 'fr' ? 'English' : 'Francais'}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Logo and title */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-slate-800 mb-2">
              LBO <span className="text-gradient">Anonymizer</span>
            </h1>
            <p className="text-slate-500">{t('login.subtitle')}</p>
          </div>

          {/* Welcome card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-slate-800 mb-4">{t('login.title')}</h2>

            {/* Privacy reassurance */}
            <div className="mb-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                <div>
                  <p className="font-medium text-emerald-800 mb-1">{t('login.privacyHeading')}</p>
                  <p className="text-sm text-emerald-700 leading-relaxed">{t('login.privacyText')}</p>
                </div>
              </div>
            </div>

            {/* Bullet points */}
            <ul className="space-y-3 mb-6">
              <li className="flex items-center gap-3 text-sm text-slate-600">
                <svg className="w-4 h-4 text-primary-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" />
                </svg>
                {t('login.bulletLocal')}
              </li>
              <li className="flex items-center gap-3 text-sm text-slate-600">
                <svg className="w-4 h-4 text-primary-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                {t('login.bulletNoUpload')}
              </li>
              <li className="flex items-center gap-3 text-sm text-slate-600">
                <svg className="w-4 h-4 text-primary-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
                {t('login.bulletNoAccount')}
              </li>
            </ul>

            {/* Connect button */}
            <button
              onClick={handleConnect}
              disabled={loading}
              className="w-full py-3 px-4 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-base"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t('login.loggingIn')}
                </span>
              ) : (
                t('login.submit')
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-slate-400 text-sm">
          {t('landing.footer')}
        </p>
      </footer>
    </div>
  )
}
