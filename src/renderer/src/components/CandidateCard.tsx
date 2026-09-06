import type { MatchResult } from '@shared/types.js'
import ScoreRing from './ScoreRing.js'
import { useI18n } from '../i18n.js'

/** Compact component-score readout; the full breakdown lives in the detail panel. */
function MiniBar({ label, value }: { label: string; value: number }): React.JSX.Element {
  const { t, formatNumber } = useI18n()
  return (
    <span className="mini-bar" title={t('{label}: {score} of 100', { label, score: formatNumber(Math.round(value * 100)) })}>
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
  const { t, formatNumber } = useI18n()
  const contacts = [
    { value: match.resume.email, direction: 'ltr' },
    { value: match.resume.phone, direction: 'ltr' },
    { value: match.resume.location, direction: 'auto' },
    { value: match.resume.yearsExperience !== null ? t('{count} yrs', { count: formatNumber(match.resume.yearsExperience) }) : null, direction: 'auto' },
    { value: match.resume.educationLevel ? t(match.resume.educationLevel) : null, direction: 'auto' }
  ].filter((item) => item.value)
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
      aria-label={t('Open details for {name}', { name: match.resume.name ?? match.resume.fileName })}
    >
      <span className="rank"><bdi>#{formatNumber(rank)}</bdi></span>

      <div className="who">
        <div className="who-text">
          <h3 className="name" dir="auto">{match.resume.name ?? match.resume.fileName}</h3>
          <div className="meta">{contacts.length ? contacts.map((item, index) => (
            <span key={index}>{index > 0 && ' · '}<bdi dir={item.direction}>{item.value}</bdi></span>
          )) : <bdi>{match.resume.fileName}</bdi>}</div>
        </div>
        <ScoreRing value={match.score} />
      </div>

      <div className="breakdown">
        <MiniBar label={t('Semantic')} value={match.breakdown.semantic} />
        <MiniBar label={t('Keyword')} value={match.breakdown.lexical} />
        <MiniBar label={t('Skills')} value={match.breakdown.skills} />
      </div>

      {(match.matchedSkills.length > 0 || match.missingSkills.length > 0) && (
        <div className="chips">
          {match.matchedSkills.slice(0, 6).map((s) => (
            <span key={s} className="chip matched">
              <bdi>{s}</bdi>
            </span>
          ))}
          {match.missingSkills.slice(0, 4).map((s) => (
            <span key={s} className="chip missing">
              <bdi>{s}</bdi>
            </span>
          ))}
        </div>
      )}

      {/* Present only after a Claude rerank, and marked as a judgement rather
          than quoted evidence so the two are never confused. */}
      {match.llmReason && (
        <p className="llm-reason">
          <span className="tag" dir="ltr">Claude</span>
          <bdi>{match.llmReason}</bdi>
        </p>
      )}

      {match.evidence[0] && (
        <blockquote className="evidence">
          <span className="tag">
            {t(match.evidence[0].section)} · {t('{score}% match', { score: formatNumber(Math.round(match.evidence[0].similarity * 100)) })}
          </span>
          <q dir="auto">{match.evidence[0].text}</q>
        </blockquote>
      )}

      <div className="card-foot">
        <span className="open-hint">{t('View details')}</span>
      </div>
    </article>
  )
}
