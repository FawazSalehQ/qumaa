/**
 * Near-duplicate detection.
 *
 * Content hashing only catches byte-identical text, so the same candidate
 * applying twice with a lightly edited CV lands in the library twice and can
 * occupy two of the three result slots. That happened in testing with two
 * versions of one resume that differed only in an end date.
 *
 * Each resume stores a document vector, the mean of its chunk vectors. Comparing
 * against those instead of against every chunk is what keeps a bulk import
 * linear: the first implementation read the whole chunk table on every insert,
 * which made importing N resumes O(N squared).
 */
import { blobToVector, getDb } from '../db/index.js'
import { EMBEDDING_DIM } from '../embed/protocol.js'

/**
 * Cosine above this counts as "probably the same person". Tuned deliberately
 * high: two different backend engineers with similar stacks sit around 0.90 with
 * this model, so a lower bar would flag genuinely distinct candidates. A
 * one-date edit of the same CV measures 0.999.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.97

export interface NearDuplicate {
  id: number
  name: string | null
  fileName: string
  similarity: number
}

/** Mean of the chunk vectors, renormalised to unit length. */
export function documentVector(vectors: Float32Array[]): Float32Array {
  const mean = new Float32Array(EMBEDDING_DIM)
  if (vectors.length === 0) return mean

  for (const v of vectors) {
    for (let i = 0; i < EMBEDDING_DIM; i++) mean[i] += v[i]
  }

  let norm = 0
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    mean[i] /= vectors.length
    norm += mean[i] * mean[i]
  }
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) mean[i] /= norm
  }
  return mean
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * The closest existing resume to `vector`, if it clears the threshold.
 *
 * Rows written before the doc_vector column existed are skipped rather than
 * back-computed here, so an import never pays to rebuild history. `backfill`
 * handles those once, at startup.
 */
export function findNearDuplicate(vector: Float32Array, excludeId?: number): NearDuplicate | null {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, name, file_name AS fileName, doc_vector
       FROM resumes
       WHERE doc_vector IS NOT NULL${excludeId ? ' AND id != ?' : ''}`
    )
    .all(...(excludeId ? [excludeId] : [])) as Array<{
    id: number
    name: string | null
    fileName: string
    doc_vector: Buffer
  }>

  let best: NearDuplicate | null = null
  for (const row of rows) {
    const sim = dot(vector, blobToVector(row.doc_vector))
    if (sim >= NEAR_DUPLICATE_THRESHOLD && (!best || sim > best.similarity)) {
      best = { id: row.id, name: row.name, fileName: row.fileName, similarity: sim }
    }
  }
  return best
}

/**
 * Computes doc_vector for any resume missing one.
 *
 * Needed after the column is added to an existing library, and after a reindex,
 * which rewrites chunk vectors and so invalidates the means derived from them.
 */
export function backfillDocumentVectors(): number {
  const db = getDb()
  const pending = db
    .prepare('SELECT id FROM resumes WHERE doc_vector IS NULL')
    .all() as Array<{ id: number }>
  if (pending.length === 0) return 0

  const chunksFor = db.prepare('SELECT embedding FROM chunks WHERE resume_id = ?')
  const update = db.prepare('UPDATE resumes SET doc_vector = ? WHERE id = ?')

  db.transaction(() => {
    for (const { id } of pending) {
      const rows = chunksFor.all(id) as Array<{ embedding: Buffer }>
      if (rows.length === 0) continue
      const mean = documentVector(rows.map((r) => blobToVector(r.embedding)))
      update.run(Buffer.from(mean.buffer, mean.byteOffset, mean.byteLength), id)
    }
  })()

  return pending.length
}
