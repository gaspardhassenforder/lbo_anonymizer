import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fr from './locales/fr.json'

// Get saved language or detect from browser
const getSavedLanguage = (): string => {
  const saved = localStorage.getItem('language')
  if (saved && ['en', 'fr'].includes(saved)) {
    return saved
  }
  // Detect from browser
  const browserLang = navigator.language.split('-')[0]
  return browserLang === 'en' ? 'en' : 'fr'
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    lng: getSavedLanguage(),
    fallbackLng: 'fr',
    interpolation: {
      escapeValue: false,
    },
  })

// Save language preference when changed
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('language', lng)
  document.documentElement.lang = lng
})

export default i18n
