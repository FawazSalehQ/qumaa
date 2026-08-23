/**
 * In-window brand mark: the same funnel geometry as the app icon
 * (scripts/make-icon.mjs), drawn in `currentColor` so it inherits text colour.
 *
 * Kept as JSX rather than importing the generated SVG so it can take a colour
 * and a size without a second asset.
 */
export function FunnelMark({ size = 20 }: { size?: number }): React.JSX.Element {
  const box = size
  const cx = box / 2

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      fill="currentColor"
      aria-hidden="true"
      className="funnel-mark"
    >
      <rect x={cx - (box * 0.56) / 2} y={box * 0.205} width={box * 0.56} height={box * 0.058} rx={box * 0.029} />
      <rect x={cx - (box * 0.38) / 2} y={box * 0.31} width={box * 0.38} height={box * 0.058} rx={box * 0.029} />
      <path
        d={
          `M ${cx - box * 0.315} ${box * 0.435} ` +
          `L ${cx + box * 0.315} ${box * 0.435} ` +
          `L ${cx + box * 0.063} ${box * 0.7} ` +
          `L ${cx + box * 0.063} ${box * 0.815} ` +
          `L ${cx - box * 0.063} ${box * 0.815} ` +
          `L ${cx - box * 0.063} ${box * 0.7} Z`
        }
      />
    </svg>
  )
}

/** Mark plus wordmark, shown at the top-left of the window. */
export function Brand(): React.JSX.Element {
  return (
    <div className="brand">
      <span className="brand-badge">
        <FunnelMark size={18} />
      </span>
      {/* lang marks this as Arabic so the browser picks Cairo and shapes it correctly. */}
      <span className="brand-name" lang="ar">
        قُمع
      </span>
    </div>
  )
}
