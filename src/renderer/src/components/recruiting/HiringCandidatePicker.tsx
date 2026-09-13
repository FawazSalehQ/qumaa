import { useId, useMemo, useState } from 'react'
import type { ResumeSummary } from '@shared/types.js'
import { useI18n } from '../../i18n.js'

export interface HiringCandidateOption {
  personKey: string
  resume: ResumeSummary
  name: string
  shortlisted: boolean
}

interface Props {
  label: string
  value: string
  options: HiringCandidateOption[]
  excluded: string[]
  optional?: boolean
  disabled?: boolean
  onChange: (value: string) => void
}

const OPTION_LIMIT = 100

/** Keep a large library searchable without rendering thousands of option nodes. */
export default function HiringCandidatePicker({ label, value, options, excluded, optional = false, disabled = false, onChange }: Props): React.JSX.Element {
  const { t, formatNumber } = useI18n()
  const [query, setQuery] = useState('')
  const selectId = useId()
  const selected = options.find((candidate) => candidate.personKey === value)
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return options.filter((candidate) => !excluded.includes(candidate.personKey) &&
      (!needle || `${candidate.name} ${candidate.resume.fileName} ${candidate.resume.email ?? ''}`.toLocaleLowerCase().includes(needle)))
  }, [options, excluded, query])
  const visible = filtered.slice(0, OPTION_LIMIT)
  if (selected && !visible.some((candidate) => candidate.personKey === selected.personKey)) visible.unshift(selected)

  return <div className="recruit-status-choice">
    <label className="recruit-field" htmlFor={selectId}><span>{label}<small>{t(optional ? 'Optional' : 'Required')}</small></span></label>
    <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('Search for {role}', { role: label })} placeholder={t('Search candidates by name or filename')} dir="auto" disabled={disabled} />
    <select id={selectId} value={value} required={!optional} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">{t(optional ? 'No backup selected' : 'Choose a candidate…')}</option>
      {visible.map((candidate) => <option key={candidate.personKey} value={candidate.personKey}>{candidate.name}{candidate.name !== candidate.resume.fileName ? ` · ${candidate.resume.fileName}` : ''}{candidate.shortlisted ? ` · ${t('From your shortlist')}` : ''}</option>)}
    </select>
    {filtered.length > OPTION_LIMIT && <p className="hint">{t('Showing the first {count} candidates. Refine your search for more.', { count: formatNumber(OPTION_LIMIT) })}</p>}
    {!disabled && filtered.length === 0 && <p className="hint">{t('No candidates found.')}</p>}
  </div>
}
