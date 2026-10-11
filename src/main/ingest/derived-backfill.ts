/** Rebuild parser-dependent caches from retained text before opening search. */
import { getDb, getSetting, invalidateLibraryUsage, setSetting, vectorToBlob } from '../db/index.js'
import { DATABASE_LIMITS } from '../db/migrations.js'
import { embedder } from '../embed/client.js'
import { markCompletedIndexRebuild } from '../embed/reindex.js'
import { searchSessions } from '../search/sessions.js'
import { temporarySearch } from '../recruiting/temporary.js'
import { deriveResumeText } from './derive.js'
import { documentVector } from './duplicates.js'
import { RESUME_DERIVATION_KEY, RESUME_DERIVATION_VERSION } from './derivation-version.js'
import { SKILL_GAZETTEER_VERSION } from './skills-backfill-plan.js'

export function isResumeDerivationCurrent(): boolean {
  return getSetting(RESUME_DERIVATION_KEY) === RESUME_DERIVATION_VERSION
}

export function markResumeDerivationCurrent(): void {
  setSetting(RESUME_DERIVATION_KEY, RESUME_DERIVATION_VERSION)
}

/**
 * Runs behind the startup readiness barrier. Canonical text, CV identity, file
 * paths and recruiter records are retained. Only reproducible caches change.
 * A crash leaves the incomplete marker, so the next launch retries the whole
 * rebuild before allowing searches. No original source files are needed.
 */
export async function backfillResumeDerivedData(
  onProgress?: (progress: { done: number; total: number }) => void
): Promise<number> {
  if (isResumeDerivationCurrent()) return 0
  const db = getDb()
  const ids = (db.prepare('SELECT id FROM resumes ORDER BY id').all() as Array<{ id: number }>).map((row) => row.id)
  const source = db.prepare('SELECT raw_text AS rawText, content_hash AS recordKey FROM resumes WHERE id = ?')
  const derive = (id: number): ReturnType<typeof deriveResumeText> => {
    const row = source.get(id) as { rawText: string; recordKey: string } | undefined
    if (!row) throw new Error('A resume disappeared while updating the search index.')
    const derived = deriveResumeText(row.rawText)
    if (derived.contentHash !== row.recordKey) throw new Error('A resume has an inconsistent text identity. Its original record was retained.')
    return derived
  }

  // Preflight the entire bounded library before removing any old cache. Derive
  // one resume at a time so large libraries do not retain all text or vectors.
  let count = 0
  let chars = 0
  for (const [index, id] of ids.entries()) {
    const derived = derive(id)
    count += derived.chunks.length
    chars += derived.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
    if (count > DATABASE_LIMITS.chunks || chars > DATABASE_LIMITS.totalChunkTextChars) {
      throw new Error('Updated resume sections exceed the library passage limit. The existing index was retained.')
    }
    if ((index + 1) % 10 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
  }

  db.transaction(() => {
    setSetting(RESUME_DERIVATION_KEY, `updating:${RESUME_DERIVATION_VERSION}`)
    db.prepare("DELETE FROM settings WHERE key = 'embeddingModel'").run()
    // Cached evidence stores passage ordinals; keeping it while rechunking could
    // pair an old score with unrelated new text. Notes/decisions remain intact.
    db.prepare("DELETE FROM recruiting_records WHERE kind = 'snapshot'").run()
    db.prepare('DELETE FROM chunks').run()
    db.prepare('UPDATE resumes SET doc_vector = NULL').run()
  })()
  invalidateLibraryUsage()
  searchSessions.clear()
  temporarySearch.clear()

  const update = db.prepare(`UPDATE resumes SET name = @name, email = @email, phone = @phone,
    location = @location, years_experience = @yearsExperience, education_level = @educationLevel,
    skills_json = @skillsJson, skills_version = @skillsVersion, doc_vector = @docVector WHERE id = @id`)
  const insert = db.prepare('INSERT INTO chunks(resume_id, section, ordinal, text, embedding) VALUES (?, ?, ?, ?, ?)')
  for (const [index, id] of ids.entries()) {
    const derived = derive(id)
    const vectors = await embedder.embedPassages(derived.chunks.map((chunk) => chunk.text))
    if (vectors.length !== derived.chunks.length) throw new Error('The embedding model returned incomplete updated passages.')
    db.transaction(() => {
      update.run({ id, name: derived.fields.name, email: derived.fields.email, phone: derived.fields.phone,
        location: derived.fields.location, yearsExperience: derived.fields.yearsExperience, educationLevel: derived.fields.educationLevel,
        skillsJson: JSON.stringify(derived.fields.skills), skillsVersion: SKILL_GAZETTEER_VERSION,
        docVector: vectorToBlob(documentVector(vectors)) })
      derived.chunks.forEach((chunk, i) => insert.run(id, chunk.section, chunk.ordinal, chunk.text, vectorToBlob(vectors[i])))
    })()
    invalidateLibraryUsage()
    onProgress?.({ done: index + 1, total: ids.length })
  }
  db.transaction(() => {
    markCompletedIndexRebuild()
    markResumeDerivationCurrent()
  })()
  return ids.length
}
