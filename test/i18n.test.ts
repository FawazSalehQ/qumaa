import { describe, expect, it } from 'vitest'
import { arabicCatalogs, arabicMessages, directionFor, displayError, formatLocalizedDate, localeFor, normalizeLanguage, toIsoDateTime, translate } from '../src/shared/i18n.js'
import { ipcSchemas } from '../src/main/ipc-validation.js'

describe('application language', () => {
  it('keeps existing installations in English and rejects unsupported IPC preferences', () => {
    for (const value of [undefined, null, '', 'de', 'ar-SA', 1, { language: 'ar' }]) {
      expect(normalizeLanguage(value)).toBe('en')
      expect(ipcSchemas.language.safeParse(value).success).toBe(false)
    }
    expect(normalizeLanguage('ar')).toBe('ar')
    expect(ipcSchemas.language.parse('ar')).toBe('ar')
    expect(ipcSchemas.language.parse('en')).toBe('en')
    expect(directionFor('ar')).toBe('rtl')
    expect(directionFor('en')).toBe('ltr')
  })

  it('preserves candidate data and substitutes parameters without recursively interpreting them', () => {
    const name = 'سارة / Sarah {count} <script> +966 50 000 0000'
    expect(translate('en', 'Review {name}', { name })).toBe(`Review ${name}`)
    expect(translate('ar', 'Review {name}', { name })).toContain(name)
    expect(translate('ar', 'A user-supplied unknown phrase')).toBe('A user-supplied unknown phrase')
    expect(translate('ar', 'Importing {current} of {total}', { current: 2, total: 12 })).toBe('جارٍ استيراد الملف ٢ من ١٢')
  })

  it('uses Gregorian record dates in both interfaces', () => {
    for (const language of ['ar', 'en'] as const) {
      const formatter = new Intl.DateTimeFormat(localeFor(language), { year: 'numeric', month: 'long', day: 'numeric' })
      expect(formatter.resolvedOptions().calendar).toBe('gregory')
      expect(formatter.formatToParts(new Date('2026-09-06T12:00:00Z')).find(part => part.type === 'year')?.value).toBe(language === 'ar' ? '٢٠٢٦' : '2026')
      expect(formatLocalizedDate(language, new Date('2026-09-06T12:00:00Z'), { year: 'numeric', timeZone: 'UTC' })).toBe(language === 'ar' ? '٢٠٢٦' : '2026')
    }
  })

  it('displays explicit unknown dates and omits invalid ISO attributes without changing stored values', () => {
    const invalidDates = [8.64e15 + 1, -(8.64e15 + 1), Number.MAX_SAFE_INTEGER, Infinity, -Infinity, NaN, new Date(NaN)]
    for (const value of invalidDates) {
      expect(formatLocalizedDate('en', value)).toBe('Unknown date')
      expect(formatLocalizedDate('ar', value)).toBe('تاريخ غير معروف')
      expect(toIsoDateTime(value)).toBeUndefined()
    }
    expect(Number.isNaN((invalidDates.at(-1) as Date).getTime())).toBe(true)
  })

  it('keeps valid dates including Date boundary values exact', () => {
    for (const value of [0, Date.parse('2026-09-06T12:00:00Z'), 8.64e15, -8.64e15]) {
      expect(toIsoDateTime(value)).toBe(new Date(value).toISOString())
      expect(toIsoDateTime(new Date(value))).toBe(new Date(value).toISOString())
      for (const language of ['en', 'ar'] as const) {
        expect(formatLocalizedDate(language, value, { timeZone: 'UTC' })).toBe(new Intl.DateTimeFormat(localeFor(language), { timeZone: 'UTC' }).format(value))
      }
    }
  })

  it('translates known IPC failures while retaining useful unknown error details', () => {
    expect(displayError('ar', new Error("Error invoking remote method 'resumes:open': Error: The original resume file is not available."), 'Failed')).toBe('ملف السيرة الذاتية الأصلي غير متاح.')
    expect(displayError('en', new Error('Disk is unavailable'), 'Failed')).toBe('Disk is unavailable')
  })

  it('keeps identical source messages consistent across every screen and export', () => {
    const seen = new Map<string, string>()
    for (const catalog of arabicCatalogs) {
      for (const [key, value] of Object.entries(catalog)) {
        if (seen.has(key)) expect(value, `Conflicting Arabic translation for ${key}`).toBe(seen.get(key))
        seen.set(key, value)
      }
    }
  })

  it('preserves every interpolation placeholder in Arabic copy', () => {
    const placeholders = (text: string): string[] => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort()
    for (const [source, arabic] of Object.entries(arabicMessages)) {
      expect(arabic.trim(), `Missing translation for ${source}`).not.toBe('')
      expect(placeholders(arabic), `Placeholders differ for ${source}`).toEqual(placeholders(source))
    }
  })
})
