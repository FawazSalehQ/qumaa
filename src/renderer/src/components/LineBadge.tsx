import type { ReactNode } from 'react'
import type { PipelineStage } from '@shared/talent.js'

/**
 * The line badge: a rounded square in a line colour carrying an identity (a
 * job's or client's initials) or a stop number. It is decorative, so it is
 * hidden from the accessibility tree; the text beside it carries the name.
 */
export type LineTone = 'violet' | 'blue' | 'teal' | 'orange' | 'green' | 'amber' | 'red' | 'neutral'

/** Identity lines. State colours (green, amber, red) are never used as identities. */
const IDENTITY_TONES: readonly LineTone[] = ['violet', 'blue', 'teal', 'orange']

/** A stable identity colour for a client, derived from its id. */
export function lineToneForKey(key: string): LineTone {
  let hash = 0
  for (const char of key) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return IDENTITY_TONES[hash % IDENTITY_TONES.length]
}

/** Pipeline stages ride the line in their own colours; sourced and closed stay neutral. */
const STAGE_TONES: Record<PipelineStage, LineTone> = {
  sourced: 'neutral', contacted: 'blue', interested: 'teal', screened: 'amber', submitted: 'violet',
  interviewing: 'orange', offer: 'green', placed: 'green', closed: 'red'
}

export function stageToneFor(stage: PipelineStage): LineTone {
  return STAGE_TONES[stage]
}

/** Up to two initials, one per word, in any script. */
export function initialsFor(text: string): string {
  const words = text.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word))
  return words
    .slice(0, 2)
    .map((word) => Array.from(word).find((char) => /[\p{L}\p{N}]/u.test(char)) ?? '')
    .join('')
    .toLocaleUpperCase()
}

export default function LineBadge({
  tone = 'neutral',
  size,
  children
}: {
  tone?: LineTone
  size?: 'sm' | 'lg'
  children: ReactNode
}): React.JSX.Element {
  return (
    <span className={`lb ${tone}${size ? ` ${size}` : ''}`} aria-hidden="true">
      {children}
    </span>
  )
}
