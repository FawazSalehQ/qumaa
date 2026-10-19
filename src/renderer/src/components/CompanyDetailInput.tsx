import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { COMPANY_DETAIL_LIMIT, normalizeCompanyDetailKey } from '@shared/recruiting.js'
import { useI18n } from '../i18n.js'

export interface CompanyDetailInputHandle {
  /** Include valid text still being typed in the submitted company snapshot. */
  valuesForSave(): string[] | null
}

interface Props {
  name: string
  label: string
  values: string[]
  onChange: (values: string[]) => void
  email?: boolean
}

const CompanyDetailInput = forwardRef<CompanyDetailInputHandle, Props>(function CompanyDetailInput({ name, label, values, onChange, email = false }, ref) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const id = `company-${name}`

  const invalid = (message: string): null => {
    setError(message)
    input.current?.focus()
    return null
  }
  const valuesForSave = (): string[] | null => {
    const value = pending.trim()
    if (!value) return values
    if (value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) return invalid(t('Enter one detail of up to 512 characters.'))
    if (input.current && !input.current.checkValidity()) {
      input.current.reportValidity()
      return invalid(t(email ? 'Enter a valid email address.' : 'Check this entry.'))
    }
    if (values.some((existing) => normalizeCompanyDetailKey(existing) === normalizeCompanyDetailKey(value))) return values
    if (values.length >= COMPANY_DETAIL_LIMIT) return invalid(t('You can add up to {count} entries to each field.', { count: COMPANY_DETAIL_LIMIT }))
    return [...values, value]
  }
  useImperativeHandle(ref, () => ({ valuesForSave }))

  const add = (): void => {
    if (!pending.trim()) return
    const next = valuesForSave()
    if (!next) return
    if (next.length === values.length) {
      setStatus(t('This entry is already added.'))
      setError(null)
      input.current?.focus()
      return
    }
    setStatus('')
    onChange(next)
    setPending('')
    setError(null)
    input.current?.focus()
  }

  return <div className="company-field">
    <label htmlFor={id}>{t(label)}</label>
    <div className="company-entry-controls">
      <input ref={input} id={id} name={name} type={email ? 'email' : 'text'} maxLength={512}
        dir={email ? 'ltr' : 'auto'} autoComplete="off" value={pending}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => { setPending(event.target.value); setError(null); setStatus('') }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault()
            add()
          }
        }} />
      <button type="button" className="btn sm" aria-label={t('Add {field}', { field: t(label) })}
        disabled={!pending.trim()} onClick={add}>{t('Add')}</button>
    </div>
    {values.length > 0 && <ul className="company-entry-list" aria-label={t('Added entries for {field}', { field: t(label) })}>
      {values.map((value, index) => <li key={`${index}-${value}`} className="company-entry">
        <bdi dir={email ? 'ltr' : 'auto'}>{value}</bdi>
        <button type="button" className="company-entry-remove" aria-label={t('Remove {value} from {field}', { value, field: t(label) })}
          onClick={() => { onChange(values.filter((_, item) => item !== index)); setError(null); setStatus(''); input.current?.focus() }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 3 6 6M9 3 3 9" /></svg>
        </button>
      </li>)}
    </ul>}
    {error && <p id={`${id}-error`} className="company-entry-error" role="alert">{error}</p>}
    <span className={status ? 'company-entry-status' : 'sr-only'} role="status">{status}</span>
  </div>
})

export default CompanyDetailInput
