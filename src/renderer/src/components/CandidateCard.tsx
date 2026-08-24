import type { MatchResult } from '@shared/types.js'
import ScoreRing from './ScoreRing.js'

function contactLine(m: MatchResult): string {
  return [
    m.resume.email,
    m.resume.phone,
    m.resume.location,
    m.resume.yearsExperience !== null ? `${m.resume.yearsExperience} yrs` : null,
    m.resume.educationLevel && m.resume.educationLevel !== 'none' ? m.resume.educationLevel : null
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Compact component-score readout; the full breakdown lives in the detail panel. */
function MiniBar({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <span className="mini-bar" title={`${label}: ${Math.round(value * 100)} of 100`}>
      <span className="mini-bar-label">{label}</span>
      <span className="mini-bar-track">
        <span className="mini-bar-fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
    </span>
  )
}

export default function CandidateCard({
  match,
  rank,
  onOpen
}: {
  match: MatchResult
  rank: number
  onOpen: () => void
}): React.JSX.Element {
  return (
    <article
      className={`candidate ${rank === 1 ? 'top' : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open details for ${match.resume.name ?? match.resume.fileName}`}
    >
      <span className="rank">#{rank}</span>

      <div className="who">
        <div className="who-text">
          <h3 className="name">{match.resume.name ?? match.resume.fileName}</h3>
          <div className="meta">{contactLine(match) || match.resume.fileName}</div>
        </div>
        <ScoreRing value={match.score} />
      </div>

      <div className="breakdown">
        <MiniBar label="Semantic" value={match.breakdown.semantic} />
        <MiniBar label="Keyword" value={match.breakdown.lexical} />
        <MiniBar label="Skills" value={match.breakdown.skills} />
      </div>

      {(match.matchedSkills.length > 0 || match.missingSkills.length > 0) && (
        <div className="chips">
          {match.matchedSkills.slice(0, 6).map((s) => (
            <span key={s} className="chip matched">
              {s}
            </span>
          ))}
          {match.missingSkills.slice(0, 4).map((s) => (
            <span key={s} className="chip missing">
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Present only after a Claude rerank, and marked as a judgement rather
          than quoted evidence so the two are never confused. */}
      {match.llmReason && (
        <p className="llm-reason">
          <span className="tag">Claude</span>
          {match.llmReason}
        </p>
      )}

      {match.evidence[0] && (
        <blockquote className="evidence">
          <span className="tag">
            {match.evidence[0].section} · {Math.round(match.evidence[0].similarity * 100)}% match
          </span>
          <q>{match.evidence[0].text}</q>
        </blockquote>
      )}

      <div className="card-foot">
        <span className="open-hint">View details</span>
      </div>
    </article>
  )
}
