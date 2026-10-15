/**
 * The interface's icon set: one stroke weight, one grid, drawn here so nothing
 * depends on a glyph font or Unicode symbol. Directional icons carry
 * `directional-icon`, which the stylesheet mirrors in RTL.
 */
interface IconProps {
  size?: number
  className?: string
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    className
  }
}

/** Points along the reading direction; mirrored in RTL. */
export function ArrowIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return <svg {...base(size, `directional-icon${className ? ` ${className}` : ''}`)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
}

export function CheckIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return <svg {...base(size, className)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
}

export function CloseIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return <svg {...base(size, className)}><path d="M6 6l12 12M18 6 6 18" /></svg>
}

export function ChevronUpIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return <svg {...base(size, className)}><path d="m6 15 6-6 6 6" /></svg>
}

export function ChevronDownIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return <svg {...base(size, className)}><path d="m6 9 6 6 6-6" /></svg>
}

/** Both chevrons, for a sortable column that is not currently sorted. */
export function SortIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return <svg {...base(size, className)}><path d="m8 9 4-4 4 4M8 15l4 4 4-4" /></svg>
}
