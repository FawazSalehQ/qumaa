import { useState } from 'react'
import type { Activity, ActivityKind, SaveActivityInput } from '@shared/talent.js'
import type { SavedJob } from '@shared/recruiting.js'
import { useI18n } from '../../i18n.js'
import { jobPostingTitle } from '../../jobPosting.js'
import { dateTimeInput, inputTimestamp } from './helpers.js'
import { ACTIVITY_LABELS } from './desk-types.js'

interface Props {
  personId: string
  activity?: Activity
  jobs: SavedJob[]
  busy: boolean
  onCancel: () => void
  onSave: (input: SaveActivityInput) => Promise<boolean>
}

export default function ActivityEditor({ personId, activity, jobs, busy, onCancel, onSave }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [draft, setDraft] = useState(() => ({
    kind: activity?.kind ?? 'call' as ActivityKind, occurredAt: dateTimeInput(activity?.occurredAt ?? Date.now()),
    summary: activity?.summary ?? '', outcome: activity?.outcome ?? '', nextAction: activity?.nextAction ?? '', dueAt: dateTimeInput(activity?.dueAt), jobId: activity?.jobId ?? ''
  }))
  return <form className="talent-editor" onSubmit={(event) => {
    event.preventDefault()
    const occurredAt = inputTimestamp(draft.occurredAt)
    if (busy || occurredAt === null || !draft.summary.trim()) return
    void onSave({ ...(activity ? { id: activity.id, expectedUpdatedAt: activity.updatedAt } : {}), personId, kind: draft.kind, occurredAt,
      summary: draft.summary.trim(), outcome: draft.outcome.trim(), nextAction: draft.nextAction.trim(), dueAt: inputTimestamp(draft.dueAt),
      completedAt: activity?.completedAt ?? null, jobId: draft.jobId || null })
  }}>
    <h3>{t(activity ? 'Edit activity' : 'Log activity')}</h3><p className="hint">{t('Record a conversation, its outcome, and the next step.')}</p>
    <fieldset className="talent-form-grid" disabled={busy}>
      <label className="talent-field">{t('Activity type')}<select aria-label={t('Activity type')} value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as ActivityKind })}>{Object.entries(ACTIVITY_LABELS).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label>
      <label className="talent-field">{t('Activity date')}<input aria-label={t('Activity date')} type="datetime-local" required value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} /></label>
      <label className="talent-field talent-wide">{t('Activity summary')}<textarea aria-label={t('Activity summary')} autoFocus required rows={3} dir="auto" maxLength={2000} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
      <label className="talent-field talent-wide">{t('Outcome')}<textarea aria-label={t('Outcome')} rows={2} dir="auto" maxLength={10_000} value={draft.outcome} onChange={(event) => setDraft({ ...draft, outcome: event.target.value })} /></label>
      <label className="talent-field talent-wide">{t('Next action')}<input aria-label={t('Next action')} required={!!draft.dueAt} maxLength={2000} dir="auto" value={draft.nextAction} onChange={(event) => setDraft({ ...draft, nextAction: event.target.value })} /></label>
      <label className="talent-field">{t('Follow-up due')}<input aria-label={t('Follow-up due')} type="datetime-local" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
      <label className="talent-field">{t('Related job')}<select aria-label={t('Related job')} value={draft.jobId} onChange={(event) => setDraft({ ...draft, jobId: event.target.value })}><option value="">{t('No related job')}</option>{jobs.map((job) => <option key={job.id} value={job.id}>{jobPostingTitle(job.posting)}</option>)}</select></label>
      <div className="talent-actions talent-wide"><button type="submit" className="btn primary" disabled={!draft.summary.trim()}>{t(busy ? 'Saving…' : 'Save activity')}</button><button type="button" className="btn" onClick={onCancel}>{t('Cancel')}</button></div>
    </fieldset>
    <p className="talent-edit-notice">{t('Save or cancel your changes before leaving this workspace.')}</p>
  </form>
}
