/** Circular 0-100 score indicator, shared by the result cards and the detail panel. */
export default function ScoreRing({
  value,
  size = 52
}: {
  value: number
  size?: number
}): React.JSX.Element {
  const stroke = size * 0.077
  const r = size / 2 - stroke
  const circumference = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(1, value)) * circumference

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent-soft)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <span className="val" style={{ fontSize: size * 0.27 }}>
        {Math.round(value * 100)}
      </span>
    </div>
  )
}
