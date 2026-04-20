import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from '@/locales/en.json'
import th from '@/locales/th.json'

export const SUPPORTED_LANGUAGES = ['en', 'th'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

const LS_KEY = 'leanovate.language'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      th: { translation: th },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LS_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
    returnNull: false,
  })

i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng
  }
})

if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.resolvedLanguage || 'en'
}

export function setLanguage(lng: Language) {
  i18n.changeLanguage(lng)
}

export function getLanguage(): Language {
  const current = (i18n.resolvedLanguage || 'en') as Language
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(current) ? current : 'en'
}

export default i18n
