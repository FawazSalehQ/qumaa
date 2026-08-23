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
 * `\b` is useless next to `+`, `#`, `.` and `/`, which appear in half these terms
 * (C++, C#, .NET, CI/CD). These explicit lookarounds treat those characters as
 * part of the token instead.
 */
function toPattern(surface: string): RegExp {
  const body = escapeRegex(surface)
  const caseSensitive = surface.length <= CASE_SENSITIVE_MAX_LEN && /^[A-Za-z]+$/.test(surface)
  return new RegExp(
    `(?<![A-Za-z0-9+#.])${body}(?![A-Za-z0-9+#])`,
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

export const SKILL_COUNT = SKILLS.length
