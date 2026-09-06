import { describe, expect, it } from 'vitest'
import { normalizeLocalizedNumber, validateLocalizedNumber } from '../src/shared/localized-number.js'

describe('localized numeric input', () => {
  it.each(['٧٫٥', '۷٫۵', '7.5', ' ٧.۵ '])('normalizes %s to the same stored experience', (input) => {
    expect(normalizeLocalizedNumber(input)).toBe('7.5')
    expect(validateLocalizedNumber(input, { min: 0, max: 100, step: 0.5 })).toBeNull()
    expect(Number(normalizeLocalizedNumber(input))).toBe(7.5)
  })

  it('normalizes mixed keyboard digits, decimal separators, and Intl direction marks', () => {
    expect(normalizeLocalizedNumber('\u061c−١۲٫٥')).toBe('-12.5')
    expect(normalizeLocalizedNumber('\u2066۷.۵\u2069')).toBe('7.5')
    expect(normalizeLocalizedNumber('1e٢')).toBe('1e2')
  })

  it('retains optional blanks and rejects incomplete, nonfinite, or ambiguous input', () => {
    expect(validateLocalizedNumber('')).toBeNull()
    expect(validateLocalizedNumber('', { required: true })).toBe('required')
    for (const value of ['-', '.', '٣..٥', '١,٥', '١٬٥', '12 years', 'NaN', 'Infinity', '1e999']) {
      expect(validateLocalizedNumber(value), value).toBe('number')
    }
  })

  it('preserves range and half-year step validation in either numeral set', () => {
    expect(validateLocalizedNumber('−١', { min: 0 })).toBe('min')
    expect(validateLocalizedNumber('۱۰۱', { max: 100 })).toBe('max')
    expect(validateLocalizedNumber('۷٫۲', { min: 0, max: 100, step: 0.5 })).toBe('step')
    expect(validateLocalizedNumber('١٠٠', { min: 0, max: 100, step: 0.5 })).toBeNull()
    expect(validateLocalizedNumber('٠', { min: 0, max: 100, step: 0.5 })).toBeNull()
  })

  it('anchors the step to the minimum and tolerates binary floating point rounding', () => {
    expect(validateLocalizedNumber('٠٫٧٥', { min: 0.25, step: 0.5 })).toBeNull()
    expect(validateLocalizedNumber('٠٫٥', { min: 0.25, step: 0.5 })).toBe('step')
    expect(validateLocalizedNumber('0.3', { step: 0.1 })).toBeNull()
    expect(validateLocalizedNumber('0.33', { step: 0.1 })).toBe('step')
    expect(validateLocalizedNumber('0.33', { step: 'any' })).toBeNull()
  })
})
