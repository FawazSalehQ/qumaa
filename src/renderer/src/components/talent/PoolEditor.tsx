import { useState } from 'react'
import type { SavePoolInput, TalentFilters, TalentOverview, TalentPool } from '@shared/talent.js'
import { EMPTY_TALENT_FILTERS, filterTalentPeople } from '@shared/talent.js'
import { useI18n } from '../../i18n.js'
import { dateInput, inputTimestamp } from './helpers.js'

interface Props {
  pool?: TalentPool
  data: TalentOverview
  busy: boolean
  onCancel: () => void
  onSave: (input: SavePoolInput) => Promise<boolean>
}

export default function PoolEditor({ pool, data, busy, onCancel, onSave }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [name, setName] = useState(pool?.name ?? '')
  const [note, setNote] = useState(pool?.note ?? '')
  const [mode, setMode] = useState<'manual' | 'search'>(pool?.mode ?? 'manual')
  const [filters, setFilters] = useState<TalentFilters>(() => ({ ...(pool?.filters ?? EMPTY_TALENT_FILTERS) }))
  const fields: Array<[keyof Pick<TalentFilters, 'query' | 'location' | 'employer' | 'skill' | 'tag' | 'availability'>, string]> = [['query', 'Search text'], ['location', 'Location'], ['employer', 'Current employer'], ['skill', 'Skill'], ['tag', 'Tag'], ['availability', 'Availability']]
  const matches = filterTalentPeople(filters, data.people, data.activities).length
  return <form className="talent-editor" onSubmit={(event) => { event.preventDefault(); if (!name.trim() || busy) return; void onSave({ ...(pool ? { id: pool.id, expectedUpdatedAt: pool.updatedAt } : {}), name: name.trim(), note: note.trim(), mode, filters, personIds: pool?.members.map((member) => member.personId) ?? [] }) }}>
    <h3>{t(pool ? 'Edit talent pool' : 'New talent pool')}</h3><p className="hint">{t('Choose people yourself, or save filters that keep the pool up to date.')}</p>
    <fieldset className="talent-form-grid" disabled={busy}>
      <label className="talent-field talent-wide">{t('Pool name')}<input aria-label={t('Pool name')} autoFocus required maxLength={512} dir="auto" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="talent-field talent-wide">{t('Pool type')}<select aria-label={t('Pool type')} disabled={!!pool} value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="manual">{t('Manual talent pool')}</option><option value="search">{t('Saved search')}</option></select></label>
      <label className="talent-field talent-wide">{t('Pool notes')}<textarea aria-label={t('Pool notes')} rows={3} maxLength={10_000} dir="auto" value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {mode === 'search' ? <>
        {fields.map(([key, label]) => <label className="talent-field" key={key}>{t(label)}<input aria-label={t(label)} maxLength={512} dir="auto" value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} /></label>)}
        <label className="talent-field">{t('CV availability')}<select aria-label={t('CV availability')} value={filters.hasCv} onChange={(event) => setFilters({ ...filters, hasCv: event.target.value as TalentFilters['hasCv'] })}><option value="any">{t('Any CV status')}</option><option value="yes">{t('With a CV')}</option><option value="no">{t('Without a CV')}</option></select></label>
        <label className="talent-field">{t('Not contacted since')}<input aria-label={t('Not contacted since')} type="date" value={dateInput(filters.notContactedSince)} onChange={(event) => setFilters({ ...filters, notContactedSince: inputTimestamp(event.target.value) })} /></label>
        <p className="hint talent-wide">{t('All filters apply together. The contact date checks calls, emails, messages, and meetings.')}</p><p className="hint talent-wide" role="status">{t('{count} people match these filters', { count: matches })}</p>
      </> : <p className="hint talent-wide">{t('Save the pool, then add the people you want to keep together.')}</p>}
      <div className="talent-actions talent-wide"><button type="submit" className="btn primary" disabled={!name.trim()}>{t(busy ? 'Saving…' : 'Save talent pool')}</button><button type="button" className="btn" onClick={onCancel}>{t('Cancel')}</button></div>
    </fieldset><p className="talent-edit-notice">{t('Save or cancel your changes before leaving this workspace.')}</p>
  </form>
}
