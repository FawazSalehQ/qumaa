/** Decimal entry is converted without passing through binary fractional arithmetic. */
export function parseHiringHundredths(value: string): number {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) throw new Error('Enter non-negative amounts with at most two decimal places.')
  const [whole, fraction = ''] = value.split('.')
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('The entered amount is too large.')
  return Number(result)
}

export function hiringDecimal(value: number): string {
  if (!Number.isSafeInteger(value)) throw new RangeError('Money must be safe integer halalas.')
  const integer = BigInt(value)
  const absolute = integer < 0n ? -integer : integer
  return `${integer < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

/** Localize whole and fractional digits separately to retain every allowed halala. */
export function formatHiringMoney(value: number, locale: string): string {
  if (!Number.isSafeInteger(value)) throw new RangeError('Money must be safe integer halalas.')
  const n = BigInt(value)
  const whole = n / 100n
  const fraction = Number(n < 0n ? -(n % 100n) : n % 100n)
  const fractionText = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false }).format(fraction)
  const parts = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).formatToParts(n < 0n && whole === 0n ? -0 : whole)
  return parts.map((part) => part.type === 'fraction' ? fractionText : part.value).join('')
}
