/**
 * The official Qumaa mark: a stack of resumes narrowing into a funnel.
 *
 * Geometry is transcribed verbatim from `brand/svg/mark-color.svg` on the same
 * 0..100 viewBox, so the in-window mark and the app icon are the same drawing.
 * The brand rules forbid recolouring the funnel, so the two sheet tints are
 * fixed and only the funnel body follows the surrounding colour.
 */
type MarkTone = 'color' | 'white'

const SHEET_TOP = { x: 28, y: 10, w: 52, h: 14, r: 5 }
const SHEET_BOTTOM = { x: 22, y: 21, w: 60, h: 14, r: 5 }
const FUNNEL = '14,34 86,34 57,70 57,90 43,90 43,70'

/** Sheet fills per tone. The white mark uses opacities of its base colour. */
const TONES: Record<MarkTone, { top: string; bottom: string; funnel: string; topOp?: number; bottomOp?: number }> = {
  color: { top: '#8f5fd6', bottom: '#c0a3ea', funnel: '#2b2733' },
  white: { top: '#ffffff', bottom: '#ffffff', funnel: '#ffffff', topOp: 0.4, bottomOp: 0.68 }
}

/**
 * Below this the two sheets stop resolving as separate strokes and smear into a
 * single block, so the brand kit drops the top sheet and keeps the silhouette.
 */
const SMALL_SIZE_PX = 20

export function QumaaMark({
  size = 20,
  tone = 'color'
}: {
  size?: number
  tone?: MarkTone
}): React.JSX.Element {
  const t = TONES[tone]
  const small = size < SMALL_SIZE_PX

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      {!small && <rect {...rect(SHEET_TOP)} fill={t.top} opacity={t.topOp} />}
      <rect {...rect(SHEET_BOTTOM)} fill={t.bottom} opacity={t.bottomOp} />
      <polygon points={FUNNEL} fill={t.funnel} />
    </svg>
  )
}

function rect(s: { x: number; y: number; w: number; h: number; r: number }) {
  return { x: s.x, y: s.y, width: s.w, height: s.h, rx: s.r }
}

/**
 * The app icon tile: the mark reversed out of the ink squircle, matching
 * `brand/svg/appicon-ink.svg`. Used wherever the identity needs to read as a
 * product badge rather than a glyph.
 */
function QumaaAppIcon({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="qumaa-appicon">
      <rect width="100" height="100" rx="22" fill="#2b2733" />
      <rect {...rect(SHEET_TOP)} fill="#8f5fd6" />
      <rect {...rect(SHEET_BOTTOM)} fill="#c0a3ea" />
      <polygon points={FUNNEL} fill="#ffffff" />
    </svg>
  )
}

/**
 * The Arabic lockup. The brand rules are explicit that this reads right to left,
 * so the mark sits to the RIGHT of قُمع; `dir="rtl"` puts them in that order
 * without hard-coding the visual arrangement.
 */
export function Brand(): React.JSX.Element {
  return (
    <div className="brand" dir="rtl">
      {/* The ink tile would sit on ink chrome in dark mode and vanish, so the
          white mark takes over there. Both render; CSS picks one, which keeps
          this free of theme state. */}
      <span className="brand-mark-light">
        <QumaaAppIcon size={28} />
      </span>
      <span className="brand-mark-dark">
        <QumaaMark size={28} tone="white" />
      </span>
      {/* lang="ar" so the browser selects IBM Plex Sans Arabic and shapes the
          connected forms and the damma correctly. */}
      <span className="brand-name" lang="ar">
        قُمع
      </span>
    </div>
  )
}
