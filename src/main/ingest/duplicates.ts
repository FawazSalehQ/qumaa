/**
 * Near-duplicate detection.
 *
 * Content hashing only catches byte-identical text, so the same candidate
 * applying twice with a lightly edited CV lands in the library twice and can
 * occupy two of the three result slots. That happened in testing with two
 * versions of one resume that differed only in an end date.
 *
 * Each resume stores a document vector, the mean of its chunk vectors. Comparing
 * one vector per resume instead of every chunk keeps the scan cheap at the
 * library sizes this app targets.
 */
import { blobToVector, getDb } from '../db/index.js'
import { EMBEDDING_DIM } from '../embed/protocol.js'

/** A matching email or phone is strong evidence, but still needs the documents
 * to be about the same person rather than, for example, two people sharing a
 * household phone number. */
export const CONTACT_IDENTITY_THRESHOLD = 0.9

/** Full names are less unique than contact details, so require a much closer
 * document match before treating the pair as the same candidate. */
export const NAME_IDENTITY_THRESHOLD = 0.985

/**
 * Cosine-only fallback for old/sparse records where the two documents have no
 * reliable identity field that can be compared.
 *
 * This is intentionally far above ordinary same-profession similarity. A
 * one-date edit of the same CV measures about 0.999, while distinct candidates
 * in a homogeneous corpus can exceed the old 0.97 threshold.
 */
export const NO_IDENTITY_THRESHOLD = 0.995

/** Backwards-compatible name for callers that display the fallback threshold. */
export const NEAR_DUPLICATE_THRESHOLD = NO_IDENTITY_THRESHOLD

export interface DuplicateIdentity {
  name: string | null
  email: string | null
  phone: string | null
}

export type DuplicateBasis = 'email' | 'phone' | 'name' | 'document' | null

export interface DuplicateDecision {
  duplicate: boolean
  /** The strongest signal that justified the decision. */
  basis: DuplicateBasis
}

/** Lower-case and trim only. Provider-specific rewriting (such as removing
 * Gmail dots) could accidentally merge two genuinely different addresses. */
export function normalizeIdentityEmail(value: string | null): string | null {
  if (!value) return null
  const normalized = value.trim().toLocaleLowerCase('en-US')
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) ? normalized : null
}

/** Digits are sufficient for comparison; a leading international-dial prefix
 * is representation rather than identity. */
export function normalizeIdentityPhone(value: string | null): string | null {
  if (!value) return null
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  return digits.length >= 9 && digits.length <= 15 ? digits : null
}

function phonesMatch(a: string, b: string): boolean {
  if (a === b) return true
  // Handles a national leading zero versus an international country code. Nine
  // trailing digits are still specific enough to be a reliable phone signal.
  return a.slice(-9) === b.slice(-9)
}

/** Normalises harmless presentation differences without attempting fuzzy name
 * matching. Fuzzy names are too weak an identity signal in a large library. */
export function normalizeIdentityName(value: string | null): string | null {
  if (!value) return null
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0610-\u061A\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')

  // A one-token name is not distinctive enough to count as reliable identity.
  return normalized.length >= 5 && normalized.split(' ').length >= 2 ? normalized : null
}

interface IdentityComparison {
  emailMatch: boolean
  phoneMatch: boolean
  nameMatch: boolean
  /** Phones can be shared by relatives or generated fixtures, so a reliable
   * different full name must be able to veto a phone-only match. */
  nameConflict: boolean
  /** At least one field exists in reliable form on both records. */
  comparable: boolean
}

function compareIdentity(a: DuplicateIdentity, b: DuplicateIdentity): IdentityComparison {
  const aEmail = normalizeIdentityEmail(a.email)
  const bEmail = normalizeIdentityEmail(b.email)
  const aPhone = normalizeIdentityPhone(a.phone)
  const bPhone = normalizeIdentityPhone(b.phone)
  const aName = normalizeIdentityName(a.name)
  const bName = normalizeIdentityName(b.name)

  return {
    emailMatch: aEmail !== null && bEmail !== null && aEmail === bEmail,
    phoneMatch: aPhone !== null && bPhone !== null && phonesMatch(aPhone, bPhone),
    nameMatch: aName !== null && bName !== null && aName === bName,
    nameConflict: aName !== null && bName !== null && aName !== bName,
    comparable:
      (aEmail !== null && bEmail !== null) ||
      (aPhone !== null && bPhone !== null) ||
      (aName !== null && bName !== null)
  }
}

/**
 * Pure near-duplicate decision.
 *
 * Comparable but different identities are never rescued by cosine alone. That
 * is the important guard against two people in the same profession whose CVs
 * happen to use almost identical vocabulary. The very-high document-only
 * fallback is reserved for pairs where identity genuinely cannot be compared.
 */
export function decideNearDuplicate(
  similarity: number,
  candidate: DuplicateIdentity,
  existing: DuplicateIdentity
): DuplicateDecision {
  if (!Number.isFinite(similarity)) return { duplicate: false, basis: null }

  const identity = compareIdentity(candidate, existing)
  if (identity.emailMatch && similarity >= CONTACT_IDENTITY_THRESHOLD) {
    return { duplicate: true, basis: 'email' }
  }
  if (
    identity.phoneMatch &&
    !identity.nameConflict &&
    similarity >= CONTACT_IDENTITY_THRESHOLD
  ) {
    return { duplicate: true, basis: 'phone' }
  }
  if (identity.nameMatch && similarity >= NAME_IDENTITY_THRESHOLD) {
    return { duplicate: true, basis: 'name' }
  }
  if (identity.comparable) return { duplicate: false, basis: null }

  return similarity >= NO_IDENTITY_THRESHOLD
    ? { duplicate: true, basis: 'document' }
    : { duplicate: false, basis: null }
}

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
export function findNearDuplicate(
  vector: Float32Array,
  identity: DuplicateIdentity | null = null,
  excludeId?: number
): NearDuplicate | null {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, name, email, phone, file_name AS fileName, doc_vector
       FROM resumes
       WHERE doc_vector IS NOT NULL${excludeId ? ' AND id != ?' : ''}`
    )
    .all(...(excludeId ? [excludeId] : [])) as Array<{
    id: number
    name: string | null
    email: string | null
    phone: string | null
    fileName: string
    doc_vector: Buffer
  }>

  let best: NearDuplicate | null = null
  for (const row of rows) {
    const sim = dot(vector, blobToVector(row.doc_vector))
    const decision = decideNearDuplicate(
      sim,
      identity ?? { name: null, email: null, phone: null },
      row
    )
    if (decision.duplicate && (!best || sim > best.similarity)) {
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
