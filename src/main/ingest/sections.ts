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
    /^(?:(?:work|professional|employment|relevant|career)\s+)?(?:experience|history|employment)$/i
  ],
  ['education', /^(?:education(?:\s+(?:and|&)\s+(?:training|qualifications|certifications|skills))?|academic\s+(?:background|qualifications)|educational\s+background|qualifications)$/i],
  ['skills', /^(?:(?:technical|core|key|professional)\s+)?(?:skills(?:\s+(?:and|&)\s+competencies)?|competencies|technologies|proficiencies)$/i],
  ['projects', /^(?:projects|selected\s+projects|portfolio)$/i],
  ['summary', /^(?:(?:(?:professional|career|executive)\s+)?summary|(?:personal\s+)?profile|(?:career\s+)?objective|about(?:\s+me)?)$/i],
  ['experience', /^(?:(?:ال)?خبر(?:ة|ات)(?:\s+(?:العملية|المهنية|الوظيفية))?|التاريخ\s+(?:الوظيفي|المهني)|المسيرة\s+المهنية)$/u],
  ['education', /^(?:(?:ال)?تعليم(?:\s+و(?:التدريب|المهارات|التطوير))?|المؤهلات(?:\s+(?:العلمية|الاكاديمية|الدراسية))?|الخلفية\s+(?:العلمية|الاكاديمية)|التحصيل\s+العلمي)$/u],
  ['skills', /^(?:(?:ال)?مهارات(?:\s+(?:التقنية|الفنية|المهنية|الاساسية|الشخصية))?|الكفاءات(?:\s+(?:الاساسية|المهنية))?)$/u],
  ['projects', /^(?:(?:ال)?مشاريع(?:\s+(?:المختارة|الشخصية|المهنية))?|المشروعات|معرض\s+الاعمال)$/u],
  ['summary', /^(?:(?:ال)?ملخص(?:\s+(?:المهني|الشخصي))?|نبذة(?:\s+(?:عني|شخصية|مهنية)|\s+عن\s+(?:نفسي|المرشح))?|الملف\s+الشخصي|الهدف(?:\s+(?:الوظيفي|المهني))?)$/u]
]

/**
 * Recognize a whole label, never a prefix of prose such as "Experience with
 * Python". Markdown decoration and Arabic marks are normalized only for this
 * comparison; source text and offsets remain intact.
 */
function trimHeadingPunctuation(text: string): string {
  let end = text.length
  while (end > 0 && ':：-–—'.includes(text[end - 1])) end--
  return text.slice(0, end)
}

function trimMarkdownClosingHashes(text: string): string {
  let end = text.length
  while (end > 0 && text[end - 1] === '#') end--
  // Closing hashes are decoration only when separated from the heading.
  return end < text.length && end > 0 && /\s/u.test(text[end - 1])
    ? text.slice(0, end).trimEnd()
    : text
}

function headingKind(line: string): SectionKind | null {
  let trimmed = line.trim()
  if (/^#{1,6}\s/u.test(trimmed)) {
    trimmed = trimMarkdownClosingHashes(trimmed.replace(/^#{1,6}\s+/u, '')).trim()
  }
  // Accept whole-line emphasis, including a colon outside the closing marker.
  trimmed = trimHeadingPunctuation(trimmed).trim()
  const emphasis = trimmed.match(/^(\*{1,3}|_{1,3})(.+)\1$/u)
  if (emphasis) trimmed = emphasis[2].trim()
  trimmed = trimHeadingPunctuation(trimmed)
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/gu, '')
    .replace(/[أإآ]/gu, 'ا')
    .trim()
  if (!trimmed) return null
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
    const raw = buffer.join('\n')
    const body = raw.trim()
    if (body) sections.push({ kind: current, text: body, start: bufferStart + raw.length - raw.trimStart().length })
    buffer = []
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const kind = headingKind(line)
    if (kind) {
      flush()
      current = kind
      bufferStart = offset
      // A Setext underline belongs to the recognized heading, not its evidence.
      if (/^\s*(?:={3,}|-{3,})\s*$/u.test(lines[index + 1] ?? '')) {
        offset += lines[++index].length + 1
      }
    } else {
      if (buffer.length === 0) bufferStart = offset
      buffer.push(line)
    }
    offset += line.length + 1
  }
  flush()

  // A resume with no recognisable headings still needs to be searchable.
  if (sections.length === 0 && text.trim()) {
    return [{ kind: 'other', text: text.trim(), start: text.length - text.trimStart().length }]
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
