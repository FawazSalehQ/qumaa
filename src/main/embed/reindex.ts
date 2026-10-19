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
import { MODEL_VECTOR_ID } from './protocol.js'

const MODEL_KEY = 'embeddingModel'
// v3 includes the immutable model revision as well as the guarded readiness
// protocol. Existing libraries reindex once because their previously mutable
// `main` download cannot be proven byte-identical after the fact.
const COMMITTED_MARKER = `complete:3:${MODEL_VECTOR_ID}`
const REINDEXING_MARKER = `reindexing:3:${MODEL_VECTOR_ID}`

/** Chunks per transaction. Small enough to keep memory flat on a big library. */
const BATCH = 64

interface ReindexProgress {
  done: number
  total: number
}

export function storedModel(): string | null {
  return getSetting(MODEL_KEY)
}

/** True only for an index fully committed under the guarded marker protocol. */
export function isIndexCommitted(): boolean {
  return storedModel() === COMMITTED_MARKER
}

/**
 * Establish the model identity before the first ingest into an empty library.
 * Once chunks exist, only a completed full reindex may change this marker.
 */
export function markEmptyIndexCurrent(): boolean {
  const db = getDb()
  const { c } = db.prepare('SELECT COUNT(*) c FROM chunks').get() as { c: number }
  if (c !== 0) return false
  setSetting(MODEL_KEY, COMMITTED_MARKER)
  return true
}

/**
 * Publishes the current model marker after a caller has rebuilt every passage
 * and every vector from canonical source text. This is intentionally separate
 * from `markEmptyIndexCurrent`: a non-empty index must earn the marker only at
 * the very end of its complete rebuild.
 */
export function markCompletedIndexRebuild(): void {
  setSetting(MODEL_KEY, COMMITTED_MARKER)
}

/** True when the library holds vectors from a different model than the current one. */
export function needsReindex(): boolean {
  const db = getDb()
  const { c } = db.prepare('SELECT COUNT(*) c FROM chunks').get() as { c: number }
  if (c === 0) return false
  return !isIndexCommitted()
}

/**
 * Rebuilds every chunk vector with the current model. Safe to interrupt: the
 * model marker is only written once every chunk has been rewritten, so a crash
 * midway leaves the mismatch in place and the work restarts next launch.
 */
export async function reindexAll(onProgress?: (p: ReindexProgress) => void): Promise<number> {
  const db = getDb()
  // Invalidate the committed marker *before* the first vector changes. If the
  // process exits after any batch, the next launch sees a mismatch and starts
  // the rebuild again instead of trusting a partially mixed index.
  setSetting(MODEL_KEY, REINDEXING_MARKER)

  const rows = db.prepare('SELECT id, text FROM chunks ORDER BY id').all() as Array<{
    id: number
    text: string
  }>
  if (rows.length === 0) {
    markCompletedIndexRebuild()
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
  // now wrong. Publish the new model marker atomically with invalidating those
  // derivatives. A crash therefore leaves either the incomplete marker, which
  // forces another rebuild, or a committed index with vectors visibly pending.
  db.transaction(() => {
    db.exec('UPDATE resumes SET doc_vector = NULL')
    markCompletedIndexRebuild()
  })()

  return rows.length
}
