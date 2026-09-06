/** Offline UI localization. English messages are stable keys; saved data is never translated. */
import { commonAr } from './locales/common.js'
import { recruitingAr } from './locales/recruiting.js'
import { matchingAr } from './locales/matching.js'
import { nativeAr } from './locales/native.js'
import { exportsAr } from './locales/exports.js'

export type Language = 'en' | 'ar'
export type TranslationValues = Record<string, string | number>
export type Translator = (message: string, values?: TranslationValues) => string

export const arabicMessages: Readonly<Record<string, string>> = {
  ...commonAr, ...recruitingAr, ...matchingAr, ...nativeAr, ...exportsAr
}

export function normalizeLanguage(value: unknown): Language {
  return value === 'ar' ? 'ar' : 'en'
}

export function localeFor(language: Language): string {
  // Keep the Gregorian calendar used for application records in both languages.
  return language === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-US'
}

export function directionFor(language: Language): 'ltr' | 'rtl' {
  return language === 'ar' ? 'rtl' : 'ltr'
}

export function translate(language: Language, message: string, values: TranslationValues = {}): string {
  const template = language === 'ar' ? (arabicMessages[message] ?? message) : message
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => {
    const value = values[key]
    if (value === undefined) return placeholder
    return typeof value === 'number' ? new Intl.NumberFormat(localeFor(language)).format(value) : value
  })
}

/** Preserve useful error details without showing Electron's transport wrapper. */
export function displayError(language: Language, error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback
  const clean = message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
  return translate(language, clean || fallback)
}
