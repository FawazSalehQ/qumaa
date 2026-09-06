/**
 * Reconstructs every ranking-relevant resume derivative after portable restore.
 *
 * A `.qumaa-backup` is user-selected SQLite input. Its retained `raw_text` is
 * canonical; hashes, parsed fields, skills, chunks, and vectors are only caches
 * and must never be trusted just because they have a valid SQLite type/shape.
 */
import { randomUUID } from 'node:crypto'
import { getDb, vectorToBlob } from '../db/index.js'
import { DATABASE_LIMITS, rebuildAndVerifySearchIndex } from '../db/migrations.js'
import { embedder } from '../embed/client.js'
import { markCompletedIndexRebuild } from '../embed/reindex.js'
import { documentVector } from './duplicates.js'
import {
  deriveResumeText,
  normalizeResumeText,
  resumeContentHash
} from './derive.js'
import { SKILL_GAZETTEER_VERSION } from './skills-backfill-plan.js'

interface StoredResumeText {
  id: number
  rawText: string
}

export interface RestoreRebuildProgress {
  processed: number
  total: number
}

export interface RestoreRebuildResult {
  resumeCount: number
  chunkCount: number
}

/**
 * Must run while the restore marker and rollback database are still present and
 * while application reads are excluded by the maintenance gate.
 */
export async function rebuildRestoredDerivedData(
  onProgress?: (progress: RestoreRebuildProgress) => void
): Promise<RestoreRebuildResult> {
  const db = getDb()
  const resumeCount = (
    db.prepare('SELECT COUNT(*) AS count FROM resumes').get() as { count: number }
  ).count

  // Detect canonical duplicates before modifying the installed candidate. A
  // legitimate Qumaa import would have deduplicated these; silently dropping
  // either restored record would be unexpected data loss.
  const seenHashes = new Map<string, number>()
  const resumeIds: number[] = []
  const selectTexts = db.prepare(
    'SELECT id, raw_text AS rawText FROM resumes ORDER BY id'
  )
  for (const row of selectTexts.iterate() as IterableIterator<StoredResumeText>) {
    if (!Number.isSafeInteger(row.id)) {
      throw new Error('The backup contains an invalid resume identifier.')
    }
    if (typeof row.rawText !== 'string') {
      throw new Error(`Restored resume ${row.id} does not contain canonical text.`)
    }
    const hash = resumeContentHash(normalizeResumeText(row.rawText))
    const previousId = seenHashes.get(hash)
    if (previousId !== undefined) {
      throw new Error(
        `The backup contains duplicate canonical resume text (records ${previousId} and ${row.id}).`
      )
    }
    seenHashes.set(hash, row.id)
    resumeIds.push(row.id)
  }

  // Move every attacker-controlled hash out of the way before assigning the
  // canonical values. The random namespace is checked even though guessing it
  // before this process starts is already impractical.
  let temporaryPrefix: string
  do {
    temporaryPrefix = `restore-rebuild:${randomUUID()}:`
  } while (
    db
      .prepare('SELECT 1 FROM resumes WHERE instr(content_hash, ?) = 1 LIMIT 1')
      .get(temporaryPrefix)
  )

  db.transaction(() => {
    db.prepare("DELETE FROM settings WHERE key = 'embeddingModel'").run()
    db.prepare('UPDATE resumes SET content_hash = ? || CAST(id AS TEXT)').run(
      temporaryPrefix
    )
    // Old passages are an untrusted assertion about the source text. Removing
    // them up front guarantees no forged row can survive a partial rebuild.
    db.prepare('DELETE FROM chunks').run()
  })()

  const updateResume = db.prepare(
    `UPDATE resumes
     SET file_path = '',
         content_hash = @content_hash,
         raw_text = @raw_text,
         name = @name,
         email = @email,
         phone = @phone,
         location = @location,
         years_experience = @years_experience,
         education_level = @education_level,
         skills_json = @skills_json,
         skills_version = @skills_version,
         likely_scanned = 0,
         doc_vector = @doc_vector
     WHERE id = @id`
  )
  const insertChunk = db.prepare(
    'INSERT INTO chunks (resume_id, section, ordinal, text, embedding) VALUES (?, ?, ?, ?, ?)'
  )
  const textForResume = db.prepare(
    'SELECT id, raw_text AS rawText FROM resumes WHERE id = ?'
  )

  let processed = 0
  let chunkCount = 0
  // Iterate over the bounded id snapshot rather than keeping a SQLite cursor
  // active while the per-resume write transactions run on this connection.
  for (const resumeId of resumeIds) {
    const row = textForResume.get(resumeId) as StoredResumeText | undefined
    if (!row) throw new Error(`Restored resume ${resumeId} disappeared during index rebuilding.`)
    const derived = deriveResumeText(row.rawText)
    chunkCount += derived.chunks.length
    if (chunkCount > DATABASE_LIMITS.chunks) {
      throw new Error(
        `Canonical resume text produces more than ${DATABASE_LIMITS.chunks} searchable passages.`
      )
    }

    const vectors = await embedder.embedPassages(derived.chunks.map((chunk) => chunk.text))
    if (vectors.length !== derived.chunks.length) {
      throw new Error(`The embedding model returned an incomplete result for resume ${row.id}.`)
    }
    const docVector = documentVector(vectors)

    db.transaction(() => {
      const updated = updateResume.run({
        id: row.id,
        content_hash: derived.contentHash,
        raw_text: derived.normalized,
        name: derived.fields.name,
        email: derived.fields.email,
        phone: derived.fields.phone,
        location: derived.fields.location,
        years_experience: derived.fields.yearsExperience,
        education_level: derived.fields.educationLevel,
        skills_json: JSON.stringify(derived.fields.skills),
        skills_version: SKILL_GAZETTEER_VERSION,
        doc_vector: vectorToBlob(docVector)
      })
      if (updated.changes !== 1) {
        throw new Error(`Restored resume ${row.id} disappeared during index rebuilding.`)
      }

      derived.chunks.forEach((chunk, index) => {
        insertChunk.run(
          row.id,
          chunk.section,
          chunk.ordinal,
          chunk.text,
          vectorToBlob(vectors[index])
        )
      })
    })()

    processed++
    onProgress?.({ processed, total: resumeCount })
  }

  // FTS is derived from the newly normalised source text. Only after its
  // external-content integrity check succeeds may this vector set be marked as
  // complete for the bundled immutable model.
  rebuildAndVerifySearchIndex(db)
  markCompletedIndexRebuild()
  return { resumeCount, chunkCount }
}
