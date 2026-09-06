/**
 * Pure, testable pieces of the resume-skill backfill.
 *
 * The version is derived from the gazetteer's semantic content rather than a
 * hand-maintained counter. Adding a skill, correcting a label, or changing an
 * alias therefore makes every older resume eligible for extraction again.
 */
import { createHash } from 'node:crypto'
import skillsData from '../data/skills.json'
import { extractSkills } from './skills.js'

interface SkillDefinition {
  id: string
  label: string
  aliases: string[]
}

export interface StoredResumeSkills {
  id: number
  rawText: string
  skillsVersion: string
}

interface SkillUpdate {
  id: number
  skillsJson: string
  skillsVersion: string
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Hash a canonical representation so harmless JSON reformatting and ordering
 * do not make a whole library backfill unnecessarily.
 */
export function fingerprintSkillGazetteer(definitions: readonly SkillDefinition[]): string {
  const canonical = definitions
    .map(({ id, label, aliases }) => ({
      id,
      label,
      aliases: [...aliases].sort(compareText)
    }))
    .sort((a, b) => compareText(a.id, b.id))

  return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`
}

export const SKILL_GAZETTEER_VERSION = fingerprintSkillGazetteer(
  skillsData as SkillDefinition[]
)

/** Re-extract only rows not already tagged with the current gazetteer. */
export function planSkillBackfill(
  rows: readonly StoredResumeSkills[],
  extract: (text: string) => string[] = extractSkills,
  version = SKILL_GAZETTEER_VERSION
): SkillUpdate[] {
  const updates: SkillUpdate[] = []

  for (const row of rows) {
    if (row.skillsVersion === version) continue
    const skillsJson = JSON.stringify(extract(row.rawText))
    updates.push({ id: row.id, skillsJson, skillsVersion: version })
  }

  return updates
}
