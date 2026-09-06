import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { directionFor, localeFor, normalizeLanguage, translate, type Language, type Translator } from '@shared/i18n.js'

interface I18nContextValue {
  language: Language
  locale: string
  t: Translator
  setLanguage: (language: Language) => Promise<void>
  reloadLanguage: () => Promise<void>
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  formatDate: (value: number | Date, options?: Intl.DateTimeFormatOptions) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [language, setLanguageState] = useState<Language>('en')
  const [ready, setReady] = useState(false)
  const revision = useRef(0)

  const reloadLanguage = useCallback(async () => {
    const current = ++revision.current
    try {
      const settings = await window.api.settings.get()
      if (current === revision.current) setLanguageState(normalizeLanguage(settings.language))
    } finally {
      if (current === revision.current) setReady(true)
    }
  }, [])

  useEffect(() => { void reloadLanguage().catch(() => { /* Settings remain accessible for retry. */ }) }, [reloadLanguage])

  useLayoutEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = directionFor(language)
    document.title = language === 'ar' ? 'قُمع' : 'Qumaa'
  }, [language])

  const setLanguage = useCallback(async (next: Language) => {
    const current = ++revision.current
    const saved = await window.api.settings.setLanguage(next)
    if (current === revision.current) setLanguageState(normalizeLanguage(saved))
  }, [])

  const value = useMemo<I18nContextValue>(() => ({
    language,
    locale: localeFor(language),
    t: (message, values) => translate(language, message, values),
    setLanguage,
    reloadLanguage,
    formatNumber: (number, options) => new Intl.NumberFormat(localeFor(language), options).format(number),
    formatDate: (date, options) => new Intl.DateTimeFormat(localeFor(language), options).format(date)
  }), [language, setLanguage, reloadLanguage])

  return <I18nContext.Provider value={value}>{ready ? children : null}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within LanguageProvider')
  return context
}
