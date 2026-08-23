import { useEffect, useState } from 'react'
import type { MatchResult, ResumeDetail as Detail, ResumeSummary } from '@shared/types.js'
import ScoreRing from './ScoreRing.js'

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
}

/** Turns the three component scores into a sentence, so the numbers mean something. */
function readScore(m: MatchResult): string {
  const { semantic, lexical, skills } = m.breakdown
  const parts: string[] = []

  if (semantic >= 0.75) parts.push('their experience closely resembles the work described')
  else if (semantic >= 0.4) parts.push('their experience partly resembles the work described')
  else parts.push('their experience is a weak fit for the work described')

  if (m.matchedSkills.length && !m.missingSkills.length) parts.push('and they have every listed skill')
  else if (m.matchedSkills.length)
    parts.push(`and they have ${m.matchedSkills.length} of ${m.matchedSkills.length + m.missingSkills.length} listed skills`)
  else if (m.missingSkills.length) parts.push('but none of the listed skills were found')

  if (lexical >= 0.75) parts.push('with strong keyword overlap')
  else if (lexical <= 0.25) parts.push('with little keyword overlap')

  if (skills < 1 && m.missingSkills.length) {
    return `${parts.join(', ')}. Missing: ${m.missingSkills.join(', ')}.`
  }
  return `${parts.join(', ')}.`
}

function Bar({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="score-bar">
      <span className="score-bar-label">{label}</span>
      <span className="score-bar-track">
        <span className="score-bar-fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="score-bar-value">{Math.round(value * 100)}</span>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }): React.JSX.Element {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd className={value ? '' : 'muted'}>{value || 'n/a'}</dd>
    </div>
  )
}

export default function ResumeDetail({ resume, match, onClose, onDeleted }: Props): React.JSX.Element {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [showAllText, setShowAllText] = useState(false)

  useEffect(() => {
    let live = true
    window.api.resumes.get(resume.id).then((d) => {
      if (live) setDetail(d)
    })
    return () => {
      live = false
    }
  }, [resume.id])

  // Esc closes, matching every other slide-over the user has met.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const remove = async (): Promise<void> => {
    await window.api.resumes.remove(resume.id)
    onDeleted()
  }

  const contact = [resume.email, resume.phone, resume.location].filter(Boolean).join('  ·  ')

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="detail" role="dialog" aria-label={`Details for ${resume.name ?? resume.fileName}`}>
        <header className="detail-head">
          <div>
            <h2>{resume.name ?? resume.fileName}</h2>
            <div className="detail-sub">{contact || resume.fileName}</div>
          </div>
          {match && <ScoreRing value={match.score} size={56} />}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="detail-body">
          {match && (
            <section>
              <h3>Why this ranked here</h3>
              <p className="reading">{readScore(match)}</p>
              <div className="score-bars">
                <Bar label="Semantic" value={match.breakdown.semantic} />
                <Bar label="Keyword" value={match.breakdown.lexical} />
                <Bar label="Skills" value={match.breakdown.skills} />
              </div>
              {(match.matchedSkills.length > 0 || match.missingSkills.length > 0) && (
                <div className="chips">
                  {match.matchedSkills.map((s) => (
                    <span key={s} className="chip matched">
                      {s}
                    </span>
                  ))}
                  {match.missingSkills.map((s) => (
                    <span key={s} className="chip missing">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          {match && match.evidence.length > 0 && (
            <section>
              <h3>Matching passages</h3>
              {match.evidence.map((e, i) => (
                <blockquote className="evidence" key={i}>
                  <span className="tag">
                    {e.section} · {Math.round(e.similarity * 100)}% match
                  </span>
                  <q>{e.text}</q>
                </blockquote>
              ))}
            </section>
          )}

          <section>
            <h3>Extracted details</h3>
            <dl className="fields">
              <Field label="Name" value={resume.name} />
              <Field label="Email" value={resume.email} />
              <Field label="Phone" value={resume.phone} />
              <Field label="Location" value={resume.location} />
              <Field
                label="Experience"
                value={resume.yearsExperience !== null ? `${resume.yearsExperience} years` : null}
              />
              <Field label="Education" value={resume.educationLevel} />
              <Field label="Source" value={resume.fileName} />
            </dl>
            <p className="hint">
              These fields are parsed heuristically and can be wrong on unusually formatted
              resumes. Ranking never uses them.
            </p>
            {resume.skills.length > 0 && (
              <div className="chips">
                {resume.skills.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3>
              Full text{' '}
              {detail && <span className="muted">({detail.passages.length} indexed passages)</span>}
            </h3>
            {detail ? (
              <>
                <pre className={`raw-text ${showAllText ? 'expanded' : ''}`}>{detail.rawText}</pre>
                <button className="btn sm" onClick={() => setShowAllText((v) => !v)}>
                  {showAllText ? 'Collapse' : 'Show all'}
                </button>
              </>
            ) : (
              <p className="muted">Loading…</p>
            )}
          </section>
        </div>

        <footer className="detail-foot">
          {resume.filePath && (
            <>
              <button className="btn" onClick={() => window.api.resumes.open(resume.filePath)}>
                Open file
              </button>
              <button className="btn" onClick={() => window.api.resumes.reveal(resume.filePath)}>
                Reveal
              </button>
            </>
          )}
          <span className="spacer" />
          <button className="btn danger" onClick={remove}>
            Delete
          </button>
        </footer>
      </aside>
    </>
  )
}
