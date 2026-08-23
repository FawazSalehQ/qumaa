import { useEffect, useRef, useState } from 'react'
import type { MatchResult, SearchResponse } from '@shared/types.js'
import CandidateCard from '../components/CandidateCard.js'
import { FunnelMark } from '../components/Brand.js'

/** First non-empty line of the posting, used as its label once collapsed. */
function postingTitle(jd: string): string {
  const line = jd.split('\n').map((l) => l.trim()).find(Boolean) ?? 'Job description'
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

interface Props {
  resumeCount: number
  onOpenCandidate: (m: MatchResult) => void
  /** Bumped by the New Search menu command to reset this view. */
  resetSignal: number
}

export default function MatchView({
  resumeCount,
  onOpenCandidate,
  resetSignal
}: Props): React.JSX.Element {
  const [jd, setJd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [res, setRes] = useState<SearchResponse | null>(null)
  // Once results exist the posting collapses to a summary bar so the ranking
  // owns the window; editing reopens it.
  const [editing, setEditing] = useState(true)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (resetSignal === 0) return
    setJd('')
    setRes(null)
    setError(null)
    setEditing(true)
    areaRef.current?.focus()
  }, [resetSignal])

  const run = async (): Promise<void> => {
    // resumeCount is checked here too, not just on the button: the Cmd+Enter
    // shortcut would otherwise run a search the disabled button forbids.
    if (!jd.trim() || busy || resumeCount === 0) return
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.search.run(jd)
      setRes(r)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setBusy(false)
    }
  }

  const top = res?.results.slice(0, 3) ?? []
  const rest = res?.results.slice(3) ?? []
  const collapsed = res !== null && !editing

  return (
    <>
      {!collapsed && (
        <header className="view-head">
          <h2>Match a job description</h2>
          <p className="sub">
            Paste the posting below. Everything runs locally, so no resume text leaves this machine.
          </p>
        </header>
      )}

      {collapsed ? (
        <button
          className="posting-bar"
          onClick={() => {
            setEditing(true)
            requestAnimationFrame(() => areaRef.current?.focus())
          }}
        >
          <FunnelMark size={16} />
          <span className="posting-title">{postingTitle(jd)}</span>
          <span className="muted">
            {res.requiredSkills.length} skill{res.requiredSkills.length === 1 ? '' : 's'} detected
          </span>
          <span className="spacer" />
          <span className="posting-edit">Edit</span>
        </button>
      ) : (
        <>
          <textarea
            ref={areaRef}
            rows={10}
            value={jd}
            placeholder="Paste the full job description here, including the requirements list…"
            onChange={(e) => setJd(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run()
            }}
          />

          <div className="row toolbar">
            <button
              className="btn primary"
              onClick={run}
              disabled={busy || !jd.trim() || resumeCount === 0}
            >
              {busy ? 'Searching…' : 'Find matches'}
            </button>
            {res && (
              <button className="btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
            <span className="muted">
              {resumeCount === 0
                ? 'Import some resumes first by dragging them anywhere onto this window.'
                : `Searching ${resumeCount} resume${resumeCount === 1 ? '' : 's'} · ⌘↵`}
            </span>
          </div>
        </>
      )}

      {error && <div className="card error-card">{error}</div>}

      {res && (
        <div className="results">
          <div className="row results-head">
            <h3>Top {top.length}</h3>
            <span className="spacer" />
            <span className="muted">
              {res.totalCandidates} scored in {res.elapsedMs} ms
            </span>
          </div>

          {res.requiredSkills.length > 0 && (
            <div className="detected">
              <span className="muted">Skills detected in this posting</span>
              <div className="chips">
                {res.requiredSkills.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {top.length === 0 ? (
            <div className="empty">No resumes to rank.</div>
          ) : (
            <div className="podium">
              {top.map((m, i) => (
                <CandidateCard
                  key={m.resume.id}
                  match={m}
                  rank={i + 1}
                  onOpen={() => onOpenCandidate(m)}
                />
              ))}
            </div>
          )}

          {rest.length > 0 && (
            <details className="rest">
              <summary>Show the other {rest.length} ranked candidates</summary>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>#</th>
                    <th>Candidate</th>
                    <th>Matched skills</th>
                    <th className="num" style={{ width: 76 }}>
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((m, i) => (
                    <tr key={m.resume.id} className="clickable" onClick={() => onOpenCandidate(m)}>
                      <td className="muted num">{i + 4}</td>
                      <td>
                        <div className="cell-title">{m.resume.name ?? m.resume.fileName}</div>
                        <div className="cell-sub">{m.resume.fileName}</div>
                      </td>
                      <td className="muted">
                        {m.matchedSkills.slice(0, 6).join(', ') || 'none'}
                        {m.matchedSkills.length > 6 && ` +${m.matchedSkills.length - 6}`}
                      </td>
                      <td className="num strong">{Math.round(m.score * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </>
  )
}
