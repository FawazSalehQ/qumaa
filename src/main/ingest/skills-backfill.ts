/** Refresh skills stored by older gazetteer versions from retained raw text. */
import { getDb } from '../db/index.js'
import {
  planSkillBackfill,
  SKILL_GAZETTEER_VERSION,
  type StoredResumeSkills
} from './skills-backfill-plan.js'

interface SkillBackfillResult {
  updated: number
  version: string
}

/**
 * Updates every stale row in one transaction. Search is held behind the index
 * readiness barrier while this runs, so it can never observe a library where
 * only some resumes use the new vocabulary.
 */
export function backfillResumeSkills(): SkillBackfillResult {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id,
              raw_text AS rawText,
              skills_version AS skillsVersion
       FROM resumes
       WHERE skills_version != ?
       ORDER BY id`
    )
    .all(SKILL_GAZETTEER_VERSION) as StoredResumeSkills[]

  const updates = planSkillBackfill(rows)
  if (updates.length > 0) {
    const update = db.prepare(
      'UPDATE resumes SET skills_json = ?, skills_version = ? WHERE id = ?'
    )
    db.transaction(() => {
      for (const row of updates) update.run(row.skillsJson, row.skillsVersion, row.id)
    })()
  }

  return {
    updated: updates.length,
    version: SKILL_GAZETTEER_VERSION
  }
}

export { SKILL_GAZETTEER_VERSION }
