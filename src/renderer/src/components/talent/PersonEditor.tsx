import { useState } from 'react'
import type { Person, SavePersonInput } from '@shared/talent.js'
import { useI18n } from '../../i18n.js'
import { dateInput, inputTimestamp, splitLabels } from './helpers.js'

interface Props {
  person?: Person
  busy: boolean
  onCancel: () => void
  onSave: (input: SavePersonInput) => Promise<boolean>
}

export default function PersonEditor({ person, busy, onCancel, onSave }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [draft, setDraft] = useState(() => ({
    name: person?.name ?? '', email: person?.email ?? '', phone: person?.phone ?? '', employer: person?.employer ?? '',
    title: person?.title ?? '', location: person?.location ?? '', skills: person?.skills.join(', ') ?? '', tags: person?.tags.join(', ') ?? '',
    availability: person?.availability ?? '', confirmed: dateInput(person?.availabilityConfirmedAt), sourceUrl: person?.sourceUrl ?? '', note: person?.note ?? ''
  }))
  const change = (field: keyof typeof draft, value: string): void => setDraft((current) => ({ ...current, [field]: value }))
  return <form className="talent-editor" onSubmit={(event) => {
    event.preventDefault()
    if (busy || !draft.name.trim()) return
    void onSave({
      ...(person ? { id: person.id, expectedUpdatedAt: person.updatedAt } : {}),
      name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim(), employer: draft.employer.trim(), title: draft.title.trim(),
      location: draft.location.trim(), skills: splitLabels(draft.skills), tags: splitLabels(draft.tags), availability: draft.availability.trim(),
      availabilityConfirmedAt: inputTimestamp(draft.confirmed), sourceUrl: draft.sourceUrl.trim(), note: draft.note.trim()
    })
  }}>
    <h3>{t(person ? 'Edit contact' : 'New prospect')}</h3>
    <fieldset className="talent-form-grid" disabled={busy}>
      <label className="talent-field talent-wide">{t('Name')}<input aria-label={t('Name')} autoFocus required maxLength={512} dir="auto" value={draft.name} onChange={(event) => change('name', event.target.value)} /></label>
      <label className="talent-field">{t('Email')}<input aria-label={t('Email')} type="email" maxLength={512} dir="ltr" value={draft.email} onChange={(event) => change('email', event.target.value)} /></label>
      <label className="talent-field">{t('Phone')}<input aria-label={t('Phone')} type="tel" maxLength={128} dir="ltr" value={draft.phone} onChange={(event) => change('phone', event.target.value)} /></label>
      <label className="talent-field">{t('Current employer')}<input aria-label={t('Current employer')} maxLength={512} dir="auto" value={draft.employer} onChange={(event) => change('employer', event.target.value)} /></label>
      <label className="talent-field">{t('Current role')}<input aria-label={t('Current role')} maxLength={512} dir="auto" value={draft.title} onChange={(event) => change('title', event.target.value)} /></label>
      <label className="talent-field">{t('Location')}<input aria-label={t('Location')} maxLength={512} dir="auto" value={draft.location} onChange={(event) => change('location', event.target.value)} /></label>
      <label className="talent-field">{t('Source link')}<input aria-label={t('Source link')} maxLength={2048} dir="ltr" inputMode="url" value={draft.sourceUrl} onChange={(event) => change('sourceUrl', event.target.value)} /></label>
      <label className="talent-field talent-wide">{t('Contact skills')}<input aria-label={t('Contact skills')} dir="auto" maxLength={30_000} value={draft.skills} onChange={(event) => change('skills', event.target.value)} /><span className="hint">{t('Separate skills with commas.')}</span></label>
      <label className="talent-field talent-wide">{t('Contact tags')}<input aria-label={t('Contact tags')} dir="auto" maxLength={5000} value={draft.tags} onChange={(event) => change('tags', event.target.value)} /><span className="hint">{t('Separate tags with commas.')}</span></label>
      <label className="talent-field">{t('Availability')}<input aria-label={t('Availability')} maxLength={512} dir="auto" value={draft.availability} onChange={(event) => change('availability', event.target.value)} placeholder={t('e.g. Available after current project')} /></label>
      <label className="talent-field">{t('Availability last confirmed')}<input aria-label={t('Availability last confirmed')} type="date" value={draft.confirmed} max={dateInput(Date.now())} onChange={(event) => change('confirmed', event.target.value)} /></label>
      <label className="talent-field talent-wide">{t('Contact notes')}<textarea aria-label={t('Contact notes')} rows={5} maxLength={10_000} dir="auto" value={draft.note} onChange={(event) => change('note', event.target.value)} /></label>
      <div className="talent-actions talent-wide"><button type="submit" className="btn primary" disabled={!draft.name.trim()}>{t(busy ? 'Saving…' : 'Save contact')}</button><button type="button" className="btn" onClick={onCancel}>{t('Cancel')}</button></div>
    </fieldset>
    <p className="talent-edit-notice">{t('Save or cancel your changes before leaving this workspace.')}</p>
  </form>
}
