/**
 * Splits a resume into labelled regions by detecting section headings.
 *
 * Labels are used two ways: to scope field extraction (years of experience is
 * only counted inside `experience`) and to tag evidence snippets in the UI.
 */
import type { SectionKind } from '@shared/types.js'

export interface Section {
  kind: SectionKind
  text: string
  /** Character offset in the source text, for stable ordering. */
  start: number
}

const HEADING_PATTERNS: Array<[SectionKind, RegExp]> = [
  [
    'experience',
    /^(work\s+|professional\s+|employment\s+|relevant\s+)?(experience|history|employment)\b/i
  ],
  ['education', /^(education|academic\s+background|qualifications)\b/i],
  ['skills', /^(technical\s+|core\s+|key\s+)?(skills|competencies|technologies|proficiencies)\b/i],
  ['projects', /^(projects|selected\s+projects|portfolio)\b/i],
  ['summary', /^(summary|profile|objective|about(\s+me)?|professional\s+summary)\b/i]
]

/**
 * A heading is a short line that matches a known label. The length cap is what
 * stops a sentence like "I have five years of experience building..." from being
 * mistaken for an EXPERIENCE heading.
 */
const MAX_HEADING_WORDS = 5

function headingKind(line: string): SectionKind | null {
  const trimmed = line.trim().replace(/[:\-–—]+$/, '')
  if (!trimmed || trimmed.split(/\s+/).length > MAX_HEADING_WORDS) return null
  for (const [kind, re] of HEADING_PATTERNS) {
    if (re.test(trimmed)) return kind
  }
  return null
}

export function splitSections(text: string): Section[] {
  const lines = text.split('\n')
  const sections: Section[] = []

  let current: SectionKind = 'other'
  let buffer: string[] = []
  let bufferStart = 0
  let offset = 0

  const flush = (): void => {
    const body = buffer.join('\n').trim()
    if (body) sections.push({ kind: current, text: body, start: bufferStart })
    buffer = []
  }

  for (const line of lines) {
    const kind = headingKind(line)
    if (kind) {
      flush()
      current = kind
      bufferStart = offset
    } else {
      if (buffer.length === 0) bufferStart = offset
      buffer.push(line)
    }
    offset += line.length + 1
  }
  flush()

  // A resume with no recognisable headings still needs to be searchable.
  if (sections.length === 0 && text.trim()) {
    return [{ kind: 'other', text: text.trim(), start: 0 }]
  }
  return sections
}

/** Concatenated text of every section with the given label. */
export function sectionText(sections: Section[], kind: SectionKind): string {
  return sections
    .filter((s) => s.kind === kind)
    .map((s) => s.text)
    .join('\n')
}
