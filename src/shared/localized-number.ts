/** Accept both Arabic numeral sets while keeping numbers stored in canonical form. */
export function normalizeLocalizedNumber(value: string): string {
  return value.trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/−/g, '-')
    // Intl formatting can add these invisible direction markers around numbers.
    .replace(/[\u061c\u200e\u200f\u2066-\u2069]/g, '')
}

export interface NumberConstraints { required?: boolean; min?: number; max?: number; step?: number | 'any' }
export type NumberValidation = 'required' | 'number' | 'min' | 'max' | 'step' | null

/** The same min/max/step rules apply regardless of the keyboard's digit shapes. */
export function validateLocalizedNumber(raw: string, { required, min, max, step = 1 }: NumberConstraints = {}): NumberValidation {
  const value = normalizeLocalizedNumber(raw)
  if (value === '') return required ? 'required' : null
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return 'number'
  const number = Number(value)
  if (!Number.isFinite(number)) return 'number'
  if (min !== undefined && number < min) return 'min'
  if (max !== undefined && number > max) return 'max'
  if (step !== 'any' && step > 0) {
    const steps = (number - (min ?? 0)) / step
    if (Math.abs(steps - Math.round(steps)) > Math.max(1, Math.abs(steps)) * 1e-9) return 'step'
  }
  return null
}
