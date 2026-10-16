/** Offline UI localization. English messages are stable keys; saved data is never translated. */
import { commonAr } from './locales/common.js'
import { recruitingAr } from './locales/recruiting.js'
import { matchingAr } from './locales/matching.js'
import { nativeAr } from './locales/native.js'
import { exportsAr } from './locales/exports.js'
import { companiesAr } from './locales/companies.js'
import { jobsCompanyAr } from './locales/jobs-company.js'
import { talentAr } from './locales/talent.js'
import { pipelineAr } from './locales/pipeline.js'
import { clientPackAr } from './locales/client-pack.js'
import { hiringCostsAr } from './locales/hiring-costs.js'
import { hiringCostAssumptionTranslations } from './locales/hiring-costs-assumptions.js'
import { requirementsAr } from './locales/requirements.js'

export type Language = 'en' | 'ar'
export type TranslationValues = Record<string, string | number>
export type Translator = (message: string, values?: TranslationValues) => string

export const arabicMessages: Readonly<Record<string, string>> = {
  ...commonAr, ...recruitingAr, ...matchingAr, ...nativeAr, ...exportsAr, ...companiesAr, ...jobsCompanyAr,
  ...talentAr, ...pipelineAr, ...clientPackAr, ...requirementsAr, ...hiringCostsAr, ...hiringCostAssumptionTranslations
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

function validDate(value: number | Date): Date | undefined {
  const date = value instanceof Date ? value : typeof value === 'number' ? new Date(value) : undefined
  return date && Number.isFinite(date.getTime()) ? date : undefined
}

/** Malformed stored dates must not make the rest of the workspace inaccessible. */
export function formatLocalizedDate(
  language: Language,
  value: number | Date,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = validDate(value)
  return date
    ? new Intl.DateTimeFormat(localeFor(language), options).format(date)
    : translate(language, 'Unknown date')
}

/** Omit invalid machine-readable dates instead of throwing during rendering. */
export function toIsoDateTime(value: number | Date): string | undefined {
  return validDate(value)?.toISOString()
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
