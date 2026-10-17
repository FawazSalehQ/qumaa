import { criterionImportanceLabel } from '@shared/job-requirements.js'
import { useEffect, useRef, useState } from 'react'
import type { ClientPackCandidateSource, ClientPackConfig, ClientPackDocument, ClientPackPreview, ClientPackSelection, ClientPackSource } from '@shared/client-pack.js'
import { displayError } from '@shared/i18n.js'
import { useI18n } from '../../i18n.js'
import DisclosureSummary from '../DisclosureSummary.js'
import './client-pack.css'

interface Props {
  jobId: string
  active?: boolean
  sourceRevision?: number
  disabled?: boolean
  onDirtyChange?: (dirty: boolean) => void
  onToast?: (message: string) => void
}

const emptyConfig = (jobId: string): ClientPackConfig => ({ jobId, firmName: '', introduction: '', blind: true, includeCriteria: false, candidates: [] })
const verificationLabel = (value: string): string => value === 'recruiter-verified' ? 'Recruiter verified' : value === 'candidate-stated' ? 'Candidate stated; not independently verified' : 'Unverified screening answer'

function DocumentPreview({ document }: { document: ClientPackDocument }): React.JSX.Element {
  const { t, formatDate, formatNumber } = useI18n()
  return <section className="client-pack-preview" aria-label={t('Exact client presentation preview')}>
    <header className="client-pack-preview-brand"><strong lang="ar" dir="rtl">قُمع</strong>{document.firmName && <b><bdi>{document.firmName}</bdi></b>}<span>{formatDate(document.generatedAt, { year: 'numeric', month: 'long', day: 'numeric' })}</span></header>
    <p className="client-pack-eyebrow">{t('Client presentation')}</p><h3><bdi>{document.jobTitle}</bdi></h3>
    {document.introduction && <p className="client-pack-text" dir="auto">{document.introduction}</p>}
    {document.blind && <p className="hint">{t('Candidate names and contact fields are hidden. Selected free text may still identify a person.')}</p>}
    {document.criteria.length > 0 && <><h4>{t('Requirements')}</h4><ul>{document.criteria.map((criterion, index) => <li key={index}><bdi>{criterion.text}</bdi> <span className="hint">({t(criterionImportanceLabel(criterion.importance))})</span></li>)}</ul></>}
    {document.candidates.map((candidate, index) => <article key={index} className="client-pack-preview-person">
      <span className="client-pack-eyebrow">{t('Candidate {count}', { count: formatNumber(index + 1) })}</span><h3><bdi>{candidate.label}</bdi></h3>
      {candidate.contact.length > 0 && <p className="hint">{candidate.contact.map((field, fieldIndex) => <span key={field.label}>{fieldIndex > 0 ? ' · ' : ''}<bdi dir="ltr">{field.value}</bdi></span>)}</p>}
      {candidate.recommendation && <><h4>{t('Recruiter recommendation')}</h4><p dir="auto" className="client-pack-text">{candidate.recommendation}</p></>}
      {candidate.details.length > 0 && <dl className="client-pack-preview-facts">{candidate.details.map((field) => <div key={field.label}><dt>{t(field.label)}</dt><dd><bdi>{field.value}</bdi></dd></div>)}</dl>}
      {candidate.evidence.length > 0 && <><h4>{t('Selected CV evidence')}</h4>{candidate.evidence.map((evidence, evidenceIndex) => <blockquote key={evidenceIndex}><span className="hint">{t(evidence.section)} · {t('Candidate CV; not independently verified')}</span><p dir="auto" className="client-pack-text">{evidence.text}</p></blockquote>)}</>}
      {candidate.answers.length > 0 && <><h4>{t('Selected screening answers')}</h4>{candidate.answers.map((answer, answerIndex) => <div className="client-pack-preview-answer" key={answerIndex}><strong dir="auto">{answer.question}</strong><p dir="auto" className="client-pack-text">{answer.answer}</p><span className="hint">{t(verificationLabel(answer.verification))}</span></div>)}</>}
    </article>)}
    <footer className="hint">{t('Selected and ordered by the recruiter. Only the fields shown in this presentation are included.')}</footer>
  </section>
}

export default function ClientPack({ jobId, active = true, sourceRevision = 0, disabled = false, onDirtyChange, onToast }: Props): React.JSX.Element {
  const { t, language, formatNumber } = useI18n()
  const [source, setSource] = useState<ClientPackSource | null>(null)
  const [details, setDetails] = useState<ClientPackCandidateSource[]>([])
  const [config, setConfig] = useState<ClientPackConfig>(() => emptyConfig(jobId))
  const [preview, setPreview] = useState<ClientPackPreview | null>(null)
  const [selected, setSelected] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const names = useRef(new Map<string, string>())
  const selectedIds = config.candidates.map((candidate) => candidate.personId).join(',')
  const locked = disabled || loading || busy
  const unavailable = (candidate: ClientPackSelection): boolean => {
    if (!source?.candidates.some((item) => item.personId === candidate.personId)) return true
    const person = details.find((item) => item.personId === candidate.personId)
    return !person || candidate.evidenceIds.some((id) => !person.evidence.some((item) => item.id === id)) || candidate.answerIds.some((id) => !person.answers.some((item) => item.id === id))
  }
  const invalidSelection = config.candidates.some(unavailable)

  useEffect(() => { onDirtyChange?.(dirty || busy); return () => onDirtyChange?.(false) }, [dirty, busy, onDirtyChange])
  useEffect(() => {
    names.current.clear()
    setSource(null); setDetails([]); setConfig(emptyConfig(jobId)); setPreview(null); setSelected(''); setDirty(false)
  }, [jobId, revision])
  useEffect(() => {
    if (!active) return
    let canceled = false
    setLoading(true); setError(''); setNotice(''); setPreview(null)
    void window.api.clientPack.source(jobId).then((value) => {
      if (canceled) return
      for (const candidate of value.candidates) names.current.set(candidate.personId, candidate.name)
      setSource(value)
      setSelected((id) => value.candidates.some((candidate) => candidate.personId === id) ? id : '')
    })
      .catch((failure: unknown) => { if (!canceled) setError(displayError(language, failure, 'Could not load client presentation data.')) })
      .finally(() => { if (!canceled) setLoading(false) })
    return () => { canceled = true }
  }, [jobId, revision, active, sourceRevision])
  useEffect(() => {
    if (!active) return
    let canceled = false
    setDetails([])
    const availableIds = selectedIds.split(',').filter((id) => source?.candidates.some((candidate) => candidate.personId === id))
    if (!availableIds.length) { setLoadingDetails(false); return }
    setLoadingDetails(true)
    void window.api.clientPack.source(jobId, availableIds).then((value) => { if (!canceled) { setDetails(value.candidates); setError('') } })
      .catch((failure: unknown) => { if (!canceled) setError(displayError(language, failure, 'Could not load client presentation data.')) })
      .finally(() => { if (!canceled) setLoadingDetails(false) })
    return () => { canceled = true }
  }, [jobId, selectedIds, source, active])
  useEffect(() => { setPreview(null) }, [language])

  const update = (next: ClientPackConfig): void => { setConfig(next); setDirty(true); setPreview(null); setError(''); setNotice('') }
  const updatePerson = (id: string, patch: Partial<ClientPackSelection>): void => update({ ...config, candidates: config.candidates.map((candidate) => candidate.personId === id ? { ...candidate, ...patch } : candidate) })
  const add = (): void => {
    if (!source?.candidates.some((candidate) => candidate.personId === selected) || config.candidates.length >= 10 || config.candidates.some((candidate) => candidate.personId === selected)) return
    update({ ...config, candidates: [...config.candidates, { personId: selected, recommendation: '', includeContact: false, includeCompensation: false, includeAvailability: false, evidenceIds: [], answerIds: [] }] })
    setSelected('')
  }
  const move = (index: number, direction: -1 | 1): void => {
    const candidates = [...config.candidates]
    const destination = index + direction
    if (destination < 0 || destination >= candidates.length) return
    ;[candidates[index], candidates[destination]] = [candidates[destination], candidates[index]]
    update({ ...config, candidates })
  }
  const makePreview = async (): Promise<void> => {
    if (locked || loadingDetails || invalidSelection || !config.candidates.length) return
    setBusy(true); setError('')
    try { setPreview(await window.api.clientPack.preview(config)) }
    catch (failure) { setPreview(null); setError(displayError(language, failure, 'Could not preview the client presentation.')) }
    finally { setBusy(false) }
  }
  const exportPdf = async (): Promise<void> => {
    if (!preview || locked) return
    setBusy(true); setError('')
    try {
      const path = await window.api.clientPack.export({ config, previewToken: preview.previewToken })
      setPreview(null)
      if (path) { const message = t('Client presentation saved to {path}', { path }); setDirty(false); setNotice(message); onToast?.(message) }
    } catch (failure) { setPreview(null); setError(displayError(language, failure, 'Could not export the client presentation.')) }
    finally { setBusy(false) }
  }

  return <section className="client-pack" aria-label={t('Client presentation builder')}>
    <div className="recruit-section-head"><div><h3>{t('Client presentation')}</h3></div><button className="btn sm" disabled={disabled || busy} onClick={() => setRevision((value) => value + 1)}>{t('Reset presentation')}</button></div>
    <p className="client-pack-private-note">{t('Internal reviews, activity notes, CRM notes, and client feedback are never copied into this pack.')}</p>
    {error && <p className="client-pack-error" role="alert">{error}</p>}
    {notice && <p className="hint" role="status">{notice}</p>}
    {loading ? <p role="status" className="hint">{t('Loading client presentation…')}</p> : source && <>
      <fieldset className="recruit-fieldset" disabled={locked}>
        <div className="recruit-editor-columns"><label className="recruit-field">{t('Recruiter or firm name')}<input aria-label={t('Recruiter or firm name')} dir="auto" maxLength={200} value={config.firmName} onChange={(event) => update({ ...config, firmName: event.target.value })} /></label><label className="recruit-field">{t('Add person to presentation')}<select aria-label={t('Add person to presentation')} value={selected} onChange={(event) => setSelected(event.target.value)} disabled={config.candidates.length >= 10}><option value="">{t('Choose a person')}</option>{source.candidates.filter((candidate) => !config.candidates.some((item) => item.personId === candidate.personId)).map((candidate) => <option key={candidate.personId} value={candidate.personId}>{candidate.name || t('Unnamed person')}</option>)}</select></label></div>
        <div className="recruit-actions"><button type="button" className="btn sm" disabled={!selected || config.candidates.length >= 10} onClick={add}>{t('Add to presentation')}</button><span className="hint">{t('{count} of 10 selected', { count: formatNumber(config.candidates.length) })}</span></div>
        {!source.candidates.length && <p className="hint">{t('Assign people to this job in Pipeline before preparing a presentation.')}</p>}
        <label className="recruit-field">{t('Client-facing introduction')}<textarea aria-label={t('Client-facing introduction')} dir="auto" rows={3} maxLength={2000} value={config.introduction} onChange={(event) => update({ ...config, introduction: event.target.value })} /></label>
        <div className="client-pack-toggles"><label><input type="checkbox" checked={config.blind} onChange={(event) => update({ ...config, blind: event.target.checked, candidates: config.candidates.map((candidate) => ({ ...candidate, includeContact: event.target.checked ? false : candidate.includeContact })) })} />{t('Hide candidate names and contact fields')}</label><label><input type="checkbox" checked={config.includeCriteria} onChange={(event) => update({ ...config, includeCriteria: event.target.checked })} />{t('Include job criteria')}</label></div>
        {config.blind && <p className="hint">{t('Names, contact fields, source links, and employer fields are suppressed. Review selected CV passages, answers, and your own text for identifying details.')}</p>}
        {config.candidates.map((candidate, index) => {
          const person = details.find((item) => item.personId === candidate.personId)
          const assigned = source.candidates.some((item) => item.personId === candidate.personId)
          const name = source.candidates.find((item) => item.personId === candidate.personId)?.name || names.current.get(candidate.personId) || t('Unnamed person')
          const missingEvidence = person ? candidate.evidenceIds.filter((id) => !person.evidence.some((item) => item.id === id)) : []
          const missingAnswers = person ? candidate.answerIds.filter((id) => !person.answers.some((item) => item.id === id)) : []
          return <article className="client-pack-selection" key={candidate.personId} aria-label={t('Presentation selection: {name}', { name })}>
            <header><h4><span className="client-pack-position">{formatNumber(index + 1)}</span><bdi>{name}</bdi></h4><div className="recruit-actions"><button type="button" className="btn sm" disabled={index === 0} aria-label={t('Move {name} up', { name })} onClick={() => move(index, -1)}>↑</button><button type="button" className="btn sm" disabled={index === config.candidates.length - 1} aria-label={t('Move {name} down', { name })} onClick={() => move(index, 1)}>↓</button><button type="button" className="recruit-text-button" aria-label={t('Remove {name} from presentation', { name })} onClick={() => update({ ...config, candidates: config.candidates.filter((item) => item.personId !== candidate.personId) })}>{t('Remove')}</button></div></header>
            {!assigned && <p className="client-pack-error" role="alert">{t('This person is no longer assigned to the job. Your recommendation is kept here; remove this selection before previewing.')}</p>}
            {!loadingDetails && (missingEvidence.length > 0 || missingAnswers.length > 0) && <div className="client-pack-error" role="alert"><p>{t('Some selected evidence or screening answers are no longer available. Remove those selections before previewing.')}</p><button type="button" className="btn sm" onClick={() => updatePerson(candidate.personId, { evidenceIds: candidate.evidenceIds.filter((id) => !missingEvidence.includes(id)), answerIds: candidate.answerIds.filter((id) => !missingAnswers.includes(id)) })}>{t('Remove unavailable evidence and answers')}</button></div>}
            <label className="recruit-field">{t('Client-facing recommendation')}<textarea aria-label={t('Client-facing recommendation')} dir="auto" rows={3} maxLength={3000} value={candidate.recommendation} onChange={(event) => updatePerson(candidate.personId, { recommendation: event.target.value })} /></label>
            <div className="client-pack-toggles"><label><input type="checkbox" checked={candidate.includeContact} disabled={config.blind} onChange={(event) => updatePerson(candidate.personId, { includeContact: event.target.checked })} />{t('Include email and phone')}</label><label><input type="checkbox" checked={candidate.includeCompensation} onChange={(event) => updatePerson(candidate.personId, { includeCompensation: event.target.checked })} />{t('Include expected compensation')}</label><label><input type="checkbox" checked={candidate.includeAvailability} onChange={(event) => updatePerson(candidate.personId, { includeAvailability: event.target.checked })} />{t('Include availability and notice period')}</label></div>
            {loadingDetails ? <p className="hint" role="status">{t('Loading evidence and screening answers…')}</p> : person && <>
              <details className="disclosure client-pack-choices"><DisclosureSummary>{t('Choose CV evidence (up to 3)')}</DisclosureSummary>{!person.evidence.length && <p className="hint">{t('No matching CV passages are available. Refresh job matches to find supporting evidence.')}</p>}{person.evidence.map((evidence) => <label className="client-pack-choice" key={evidence.id}><input type="checkbox" checked={candidate.evidenceIds.includes(evidence.id)} disabled={!candidate.evidenceIds.includes(evidence.id) && candidate.evidenceIds.length >= 3} onChange={(event) => updatePerson(candidate.personId, { evidenceIds: event.target.checked ? [...candidate.evidenceIds, evidence.id] : candidate.evidenceIds.filter((id) => id !== evidence.id) })} /><span><small>{t(evidence.section)} · {t('Candidate CV; not independently verified')}</small><span dir="auto" className="client-pack-text">{evidence.text}</span></span></label>)}</details>
              <details className="disclosure client-pack-choices"><DisclosureSummary>{t('Choose screening answers (up to 10)')}</DisclosureSummary>{!person.answers.length && <p className="hint">{t('No answered screening questions are available for this person and job.')}</p>}{person.answers.map((answer) => <label className="client-pack-choice" key={answer.id}><input type="checkbox" checked={candidate.answerIds.includes(answer.id)} disabled={!candidate.answerIds.includes(answer.id) && candidate.answerIds.length >= 10} onChange={(event) => updatePerson(candidate.personId, { answerIds: event.target.checked ? [...candidate.answerIds, answer.id] : candidate.answerIds.filter((id) => id !== answer.id) })} /><span><strong dir="auto">{answer.question}</strong><span dir="auto" className="client-pack-text">{answer.answer}</span><small>{t(verificationLabel(answer.verification))}</small></span></label>)}</details>
            </>}
          </article>
        })}
      </fieldset>
      <div className="recruit-actions client-pack-preview-actions"><button className="btn primary" disabled={locked || loadingDetails || invalidSelection || !config.candidates.length} onClick={() => { void makePreview() }}>{busy ? t('Preparing…') : t('Preview client presentation')}</button>{preview && <button className="btn primary" disabled={locked} onClick={() => { void exportPdf() }}>{t('Export reviewed PDF')}</button>}</div>
      {preview && <DocumentPreview document={preview.document} />}
    </>}
  </section>
}
