/**
 * Re-embeds the whole library when the embedding model changes.
 *
 * Vectors from two different models are not comparable. Mixing them does not
 * throw, it just returns nonsense rankings, which is the worst possible failure
 * mode because it looks like the app is working. So the model that produced the
 * stored vectors is recorded alongside them, and any mismatch forces a rebuild.
 *
 * Re-embedding uses the chunk text already in the database, so no files are
 * re-read and nothing depends on the original documents still existing.
 */
import { getDb, getSetting, setSetting, vectorToBlob } from '../db/index.js'
import { embedder } from './client.js'
import { MODEL_ID } from './protocol.js'

const MODEL_KEY = 'embeddingModel'

/** Chunks per transaction. Small enough to keep memory flat on a big library. */
const BATCH = 64

export interface ReindexProgress {
  done: number
  total: number
}

export function storedModel(): string | null {
  return getSetting(MODEL_KEY)
}

export function markModel(): void {
  setSetting(MODEL_KEY, MODEL_ID)
}

/** True when the library holds vectors from a different model than the current one. */
export function needsReindex(): boolean {
  const db = getDb()
  const { c } = db.prepare('SELECT COUNT(*) c FROM chunks').get() as { c: number }
  if (c === 0) {
    // Nothing stored yet, so simply claim the current model.
    markModel()
    return false
  }
  return storedModel() !== MODEL_ID
}

/**
 * Rebuilds every chunk vector with the current model. Safe to interrupt: the
 * model marker is only written once every chunk has been rewritten, so a crash
 * midway leaves the mismatch in place and the work restarts next launch.
 */
export async function reindexAll(onProgress?: (p: ReindexProgress) => void): Promise<number> {
  const db = getDb()
  const rows = db.prepare('SELECT id, text FROM chunks ORDER BY id').all() as Array<{
    id: number
    text: string
  }>
  if (rows.length === 0) {
    markModel()
    return 0
  }

  const update = db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?')

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const vectors = await embedder.embedPassages(batch.map((r) => r.text))

    db.transaction(() => {
      batch.forEach((r, j) => update.run(vectorToBlob(vectors[j]), r.id))
    })()

    onProgress?.({ done: Math.min(i + BATCH, rows.length), total: rows.length })
  }

  // The document vectors were derived from the old chunk vectors, so they are
  // now wrong. Clearing them makes the backfill recompute from the new ones.
  db.exec('UPDATE resumes SET doc_vector = NULL')

  markModel()
  return rows.length
}
