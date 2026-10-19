import { useEffect, useState } from 'react'
import { useI18n } from '../i18n.js'
import type { Translator } from '@shared/i18n.js'
import { EDUCATION_LABELS, type MatchResult, type ResumeDetail as Detail, type ResumeSummary } from '@shared/types.js'
import { CloseIcon } from './Icons.js'
import RecruiterProfile from './RecruiterProfile.js'

/**
 * Slide-over showing everything known about one candidate.
 *
 * `match` is present only when opened from a search result. Opened from the
 * Library there is no ranking context, so the score section is omitted rather
 * than shown empty.
 */
interface Props {
  resume: ResumeSummary
  match?: MatchResult
  onClose: () => void
  onDeleted: () => void
  onProfileChanged?: () => void
}

/** Turns the three component scores into a sentence, so the numbers mean something. */
function readScore(m: MatchResult, t: Translator, formatNumber: (value: number) => string): string {
  const { semantic, lexical } = m.breakdown
  const parts: string[] = []

  if (semantic >= 0.75) parts.push(t('CV text similarity is high relative to this candidate pool.'))
  else if (semantic >= 0.4) parts.push(t('CV text similarity is moderate relative to this candidate pool.'))
  else parts.push(t('CV text similarity is low relative to this candidate pool.'))

  const total = m.matchedSkills.length + m.missingSkills.length
  if (total) parts.push(t('The CV mentions {matched} of {total} recognized skill terms.', {
    matched: formatNumber(m.matchedSkills.length), total: formatNumber(total)
  }))
  else parts.push(t('No skill terms were recognized in this job description. Review its requirements and source passages.'))

  if (lexical >= 0.75) parts.push(t('Keyword overlap is high relative to this candidate pool.'))
  else if (lexical <= 0.25) parts.push(t('Keyword overlap is low relative to this candidate pool.'))

  return parts.join(' ')
}

function Bar({ label, value }: { label: string; value: number }): React.JSX.Element {
  const { formatNumber } = useI18n()
  return (
    <div className="score-bar">
      <span className="score-bar-label">{label}</span>
      <span className="score-bar-track">
        <span className="score-bar-fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="score-bar-value">{formatNumber(Math.round(value * 100))}</span>
    </div>
  )
}

function Field({ label, value, dir = 'auto' }: { label: string; value: string | null; dir?: 'auto' | 'ltr' }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd className={value ? '' : 'muted'}><bdi dir={dir}>{value || t('n/a')}</bdi></dd>
    </div>
  )
}

export default function ResumeDetail({ resume, match, onClose, onDeleted, onProfileChanged }: Props): React.JSX.Element {
  const { t, formatNumber } = useI18n()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [showAllText, setShowAllText] = useState(false)

  useEffect(() => {
    let live = true
    window.api.resumes.get(resume).then((d) => {
      if (live) setDetail(d)
    })
    return () => {
      live = false
    }
  }, [resume])

  // Esc closes, matching every other slide-over the user has met.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const remove = async (): Promise<void> => {
    const deleted = await window.api.resumes.remove(resume)
    if (deleted) onDeleted()
  }

  const contact = [
    { value: resume.email, direction: 'ltr' },
    { value: resume.phone, direction: 'ltr' },
    { value: resume.location, direction: 'auto' }
  ].filter((item) => item.value)

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="detail" role="dialog" aria-label={t('Details for {name}', { name: resume.name ?? resume.fileName })}>
        <header className="detail-head">
          <div>
            <h2><bdi>{resume.name ?? resume.fileName}</bdi></h2>
            <div className="detail-sub">{contact.length ? contact.map((item, index) => <span key={index}>{index > 0 && '  ·  '}<bdi dir={item.direction}>{item.value}</bdi></span>) : <bdi>{resume.fileName}</bdi>}</div>
          </div>
          {match && <div className="detail-score" role="img" aria-label={t('{score}% match', { score: formatNumber(Math.round(match.score * 100)) })}><strong>{formatNumber(Math.round(match.score * 100))}</strong><span>{t('Match')}</span></div>}
          <button className="icon-btn" onClick={onClose} aria-label={t('Close')}>
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="detail-body">
          <RecruiterProfile key={resume.recordKey} resume={resume} onChanged={onProfileChanged} />
          {match && (
            <section>
              <h3>{t('Score breakdown')}</h3>
              <p className="reading">{readScore(match, t, formatNumber)}</p>
              <div className="score-bars">
                <Bar label={t('Semantic')} value={match.breakdown.semantic} />
                <Bar label={t('Keyword')} value={match.breakdown.lexical} />
                {(match.matchedSkills.length > 0 || match.missingSkills.length > 0) && <Bar label={t('Recognized skill terms')} value={match.breakdown.skills} />}
              </div>
              {(match.matchedSkills.length > 0 || match.missingSkills.length > 0) && (
                <div className="chips">
                  {match.matchedSkills.map((s) => (
                    <span key={s} className="chip matched" title={t('Mentioned in CV text')}>
                      <bdi>{s}</bdi>
                    </span>
                  ))}
                  {match.missingSkills.map((s) => (
                    <span key={s} className="chip missing" title={t('Not found in CV text')}>
                      <bdi>{s}</bdi>
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          {match && match.evidence.length > 0 && (
            <section>
              <h3>{t('Matching passages')}</h3>
              {match.evidence.map((e, i) => (
                <blockquote className="evidence" key={i}>
                  <span className="tag">
                    {t(e.section)} · {t('{score}% match', { score: formatNumber(Math.round(e.similarity * 100)) })}
                  </span>
                  <q dir="auto">{e.text}</q>
                </blockquote>
              ))}
            </section>
          )}

          <section>
            <h3>{t('CV extraction')}</h3>
            <dl className="fields">
              <Field label={t('Name')} value={resume.name} />
              <Field label={t('Email')} value={resume.email} dir="ltr" />
              <Field label={t('Phone')} value={resume.phone} dir="ltr" />
              <Field label={t('Location')} value={resume.location} />
              <Field
                label={t('Experience')}
                value={resume.yearsExperience !== null ? t('{count} years', { count: formatNumber(resume.yearsExperience) }) : null}
              />
              <Field label={t('Education')} value={resume.educationLevel ? t(EDUCATION_LABELS[resume.educationLevel]) : null} />
              <Field label={t('Source')} value={resume.fileName} />
            </dl>
            <p className="hint">
              {t('Parsed automatically; may be wrong. Never used for ranking.')}
            </p>
            {resume.skills.length > 0 && (
              <div className="chips">
                {resume.skills.map((s) => (
                  <span key={s} className="chip">
                    <bdi>{s}</bdi>
                  </span>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3>
              {t('Full text')}{' '}
              {detail && <span className="muted">({t('{count} indexed passages', { count: formatNumber(detail.passageCount) })})</span>}
            </h3>
            {detail ? (
              <>
                <pre dir="auto" className={`raw-text ${showAllText ? 'expanded' : ''}`}>{detail.rawText}</pre>
                <button className="btn sm" onClick={() => setShowAllText((v) => !v)}>
                  {t(showAllText ? 'Collapse' : 'Show all')}
                </button>
              </>
            ) : (
              <p className="muted">{t('Loading…')}</p>
            )}
          </section>
        </div>

        <footer className="detail-foot">
          {resume.filePath && (
            <>
              <button className="btn" onClick={() => window.api.resumes.open(resume)}>
                {t('Open file')}
              </button>
              <button className="btn" onClick={() => window.api.resumes.reveal(resume)}>
                {t('Reveal')}
              </button>
            </>
          )}
          <span className="spacer" />
          <button className="btn danger" onClick={remove}>
            {t('Delete')}
          </button>
        </footer>
      </aside>
    </>
  )
}
