import { getSetting } from './db/index.js'
import { normalizeLanguage, translate, type Language, type TranslationValues } from '@shared/i18n.js'

export const LANGUAGE_KEY = 'language'
export function currentLanguage(): Language {
  return normalizeLanguage(getSetting(LANGUAGE_KEY))
}
export function nativeText(message: string, values?: TranslationValues): string {
  return translate(currentLanguage(), message, values)
}
