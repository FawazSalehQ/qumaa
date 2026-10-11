import { describe, expect, it } from 'vitest'
import { parseHiringHundredths, hiringDecimal, formatHiringMoney } from '../src/shared/hiring-money.js'

describe('hiring money entry and presentation', () => {
  it('preserves entered halalas at the safe integer boundary', () => {
    expect(parseHiringHundredths('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER)
    expect(hiringDecimal(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91')
    expect(formatHiringMoney(Number.MAX_SAFE_INTEGER, 'en-US')).toBe('90,071,992,547,409.91')
    expect(formatHiringMoney(Number.MAX_SAFE_INTEGER, 'ar-SA')).toBe('٩٠٬٠٧١٬٩٩٢٬٥٤٧٬٤٠٩٫٩١')
    expect(() => parseHiringHundredths('90071992547409.92')).toThrow('too large')
  })
  it('accepts decimal entry without silently rounding fractions or exponent notation', () => {
    expect(parseHiringHundredths('0.29')).toBe(29)
    expect(parseHiringHundredths('12.')).toBe(1200)
    expect(parseHiringHundredths('0012.5')).toBe(1250)
    for (const value of ['', '1e3', '-1', '0.005', '.1', 'NaN']) expect(() => parseHiringHundredths(value)).toThrow()
  })
  it('retains the sign of negative estimates including amounts below one riyal', () => {
    expect(formatHiringMoney(-134375, 'en-US')).toBe('-1,343.75')
    expect(formatHiringMoney(-1, 'en-US')).toBe('-0.01')
    expect(formatHiringMoney(1, 'en-US')).toBe('0.01')
    expect(formatHiringMoney(0, 'en-US')).toBe('0.00')
    expect(hiringDecimal(-1)).toBe('-0.01')
  })
})
