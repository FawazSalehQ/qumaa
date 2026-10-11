import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react'
import { normalizeLocalizedNumber, validateLocalizedNumber } from '@shared/localized-number.js'
import { useI18n } from '../i18n.js'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'value' | 'onChange' | 'min' | 'max' | 'step'> & {
  value: string | number
  onChangeValue: (canonical: string) => void
  min?: number
  max?: number
  step?: number | 'any'
  reportOnBlur?: boolean
}

/** Native number inputs reject Arabic keyboard digits before React receives them. */
export default function LocalizedNumberInput({ value, onChangeValue, min, max, step = 1, required, reportOnBlur = true, onBlur, ...props }: Props): React.JSX.Element {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const validation = validateLocalizedNumber(String(value), { min, max, step, required })
  const message = validation === 'required' ? t('Enter a number.')
    : validation === 'number' ? t('Enter a valid number.')
    : validation === 'min' ? t('Enter a number greater than or equal to {min}.', { min: min! })
    : validation === 'max' ? t('Enter a number less than or equal to {max}.', { max: max! })
    : validation === 'step' ? t('Enter a number in increments of {step}, starting at {min}.', { step, min: min ?? 0 })
    : ''

  useLayoutEffect(() => { input.current?.setCustomValidity(message) }, [message])

  return <input {...props} ref={input} type="text" inputMode="decimal" data-numeric-input="true" dir="ltr"
    value={value} required={required} aria-invalid={validation ? true : undefined}
    onChange={(event) => onChangeValue(normalizeLocalizedNumber(event.target.value))}
    onBlur={(event) => {
      if (validation && reportOnBlur) event.currentTarget.reportValidity()
      onBlur?.(event)
    }} />
}
