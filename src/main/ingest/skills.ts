/**
 * Gazetteer-based skill detection, used on both sides of the match: resumes at
 * ingest time and job descriptions at search time. Sharing one vocabulary is what
 * makes "matched / missing skills" meaningful rather than two different notions
 * of what counts as a skill.
 */
import skillsData from '../data/skills.json'

interface SkillDef {
  id: string
  label: string
  aliases: string[]
}

const SKILLS = skillsData as SkillDef[]

/** Surface forms this short are also ordinary English words ("C", "R", "Go"),
 *  so they are matched case-sensitively against their canonical capitalisation.
 *  This trades a few misses on all-lowercase resumes for far fewer false hits. */
const CASE_SENSITIVE_MAX_LEN = 2

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Arabic word characters: letters, tatweel, diacritics and Arabic-Indic digits.
 *
 * Deliberately starts at U+0621 rather than U+0600, because U+060C is the Arabic
 * comma and U+061F the question mark. Including punctuation here makes the
 * boundary lookarounds reject a term followed by a comma, so "العناية المركزة،"
 * silently stops matching while the bare phrase still does.
 */
const ARABIC_WORD =
  '\\u0621-\\u065F\\u0660-\\u0669\\u066E-\\u06D3\\u06E5-\\u06EF\\u06FA-\\u06FF\\u0750-\\u077F'

/**
 * `\b` is useless next to `+`, `#`, `.` and `/`, which appear in half these terms
 * (C++, C#, .NET, CI/CD), and it does not understand Arabic script at all. These
 * explicit lookarounds treat those characters as part of the token instead.
 */
/**
 * Arabic attaches its conjunctions and articles directly to the following word,
 * so "مكافحة العدوى" appears in running text as "ومكافحة العدوى". A strict word
 * boundary rejects those, which silently loses most real matches. This permits
 * the common proclitics (و f b k l, optionally followed by the article ال)
 * without opening the term up to matching mid-word.
 */
const ARABIC_PROCLITIC = '[\\u0648\\u0641\\u0628\\u0643\\u0644]{0,2}(?:\\u0627\\u0644)?'

const hasArabic = (s: string): boolean => /[\u0621-\u064A]/.test(s)

function toPattern(surface: string): RegExp {
  const body = escapeRegex(surface)
  const caseSensitive = surface.length <= CASE_SENSITIVE_MAX_LEN && /^[A-Za-z]+$/.test(surface)
  const prefix = hasArabic(surface) ? ARABIC_PROCLITIC : ''
  return new RegExp(
    `(?<![A-Za-z0-9+#.${ARABIC_WORD}])${prefix}${body}(?![A-Za-z0-9+#${ARABIC_WORD}])`,
    caseSensitive ? 'g' : 'gi'
  )
}

interface CompiledSkill {
  id: string
  patterns: RegExp[]
}

const COMPILED: CompiledSkill[] = SKILLS.map((s) => ({
  id: s.id,
  patterns: [s.label, ...s.aliases].map(toPattern)
}))

const LABELS = new Map(SKILLS.map((s) => [s.id, s.label]))

/** Canonical display name for a skill id. */
export function skillLabel(id: string): string {
  return LABELS.get(id) ?? id
}

export function skillLabels(ids: string[]): string[] {
  return ids.map(skillLabel)
}

/** Detects every gazetteer skill present in the text. Returns canonical ids. */
export function extractSkills(text: string): string[] {
  const found: string[] = []
  for (const skill of COMPILED) {
    for (const pattern of skill.patterns) {
      pattern.lastIndex = 0
      if (pattern.test(text)) {
        found.push(skill.id)
        break
      }
    }
  }
  return found
}
