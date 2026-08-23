/**
 * Pure scoring math, with no database, no Electron, and no model.
 *
 * Split out from rank.ts deliberately: this is the part whose behaviour decides
 * who lands in the top three, so it needs to be testable without booting an app.
 */
import { normalizeText } from '../ingest/normalize.js'
import type { Evidence, SectionKind } from '@shared/types.js'

/** Tunable in one place. Must sum to 1. */
export const WEIGHTS = {
  semantic: 0.55,
  lexical: 0.2,
  skills: 0.25
} as const

export const MAX_REQUIREMENT_LINES = 40
/** "Experience with Kubernetes" is a real requirement; "AWS" on its own is not. */
const MIN_REQUIREMENT_WORDS = 3
/** Above this, a line is prose rather than a bullet and gets sentence-split. */
const PROSE_LINE_WORDS = 16
const EVIDENCE_PER_RESUME = 3

/* ---------- job description parsing ---------- */

/**
 * Splits a JD into individual requirements. Bullet lists are the common case;
 * prose paragraphs fall back to sentence splitting so they are not treated as
 * one giant undifferentiated requirement.
 */
export function parseRequirements(jd: string): string[] {
  const lines = normalizeText(jd)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const out: string[] = []
  for (const line of lines) {
    const words = line.split(/\s+/).length
    if (words >= PROSE_LINE_WORDS) {
      for (const sentence of line.split(/(?<=[.!?])\s+/)) {
        if (sentence.split(/\s+/).length >= MIN_REQUIREMENT_WORDS) out.push(sentence.trim())
      }
    } else if (words >= MIN_REQUIREMENT_WORDS) {
      out.push(line)
    }
  }
  return out.slice(0, MAX_REQUIREMENT_LINES)
}

/* ---------- vector maths ---------- */

/** Vectors are stored L2-normalised, so a dot product is the cosine. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

/**
 * Min-max to 0..1 across the candidate pool. Ranking is relative: an absolute
 * cosine of 0.6 means nothing without knowing what the rest of the pool scored.
 */
export function normalizeScores(values: number[]): number[] {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max - min < 1e-9) return values.map(() => (max > 0 ? 1 : 0))
  return values.map((v) => (v - min) / (max - min))
}

/* ---------- lexical ---------- */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'our', 'are', 'will', 'this', 'that', 'have', 'has',
  'from', 'your', 'their', 'about', 'into', 'they', 'them', 'been', 'were', 'was', 'not',
  'but', 'all', 'can', 'who', 'what', 'when', 'where', 'how', 'why', 'other', 'more',
  'work', 'working', 'role', 'team', 'teams', 'years', 'year', 'experience', 'ability',
  'strong', 'good', 'excellent', 'job', 'candidate', 'looking', 'seeking', 'required',
  'requirements', 'responsibilities', 'preferred', 'plus', 'must', 'should', 'well'
])

const MAX_FTS_TERMS = 60

/** Builds an FTS5 MATCH expression of the JD's salient terms, OR-ed together. */
export function buildFtsQuery(jd: string): string | null {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of jd.toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) ?? []) {
    const term = raw.replace(/\.+$/, '')
    if (term.length < 3 || STOPWORDS.has(term) || seen.has(term)) continue
    seen.add(term)
    // Double-quote to make every term a literal, because FTS5 reads bare punctuation as
    // query syntax, and JD text is full of it.
    terms.push(`"${term.replace(/"/g, '""')}"`)
    if (terms.length >= MAX_FTS_TERMS) break
  }
  return terms.length ? terms.join(' OR ') : null
}

/* ---------- per-resume semantics ---------- */

export interface ScoredChunk {
  section: SectionKind
  text: string
  vector: Float32Array
}

export interface SemanticResult {
  semantic: number
  evidence: Evidence[]
}

/**
 * `queryVectors[0]` is the whole job description; the rest are individual
 * requirements.
 *
 * Score is the mean over queries of each query's best-matching chunk. Averaging
 * *maxima* is the important detail: it credits a resume for covering many
 * separate requirements, whereas averaging everything would let one long
 * irrelevant section drag down a genuinely strong candidate.
 */
export function scoreSemantics(
  queryVectors: Float32Array[],
  chunks: ScoredChunk[]
): SemanticResult {
  if (chunks.length === 0 || queryVectors.length === 0) {
    return { semantic: 0, evidence: [] }
  }

  const perQueryBest: number[] = []
  const bestChunkScore = new Map<number, number>()
  // Evidence should be requirement-specific, so the whole-JD vector is excluded
  // unless it is all we have.
  const evidenceStart = queryVectors.length > 1 ? 1 : 0

  queryVectors.forEach((qv, qi) => {
    let best = -Infinity
    chunks.forEach((chunk, ci) => {
      const sim = cosine(qv, chunk.vector)
      if (sim > best) best = sim
      if (qi >= evidenceStart) {
        const prev = bestChunkScore.get(ci)
        if (prev === undefined || sim > prev) bestChunkScore.set(ci, sim)
      }
    })
    perQueryBest.push(best)
  })

  const semantic = perQueryBest.reduce((a, b) => a + b, 0) / perQueryBest.length

  const evidence: Evidence[] = [...bestChunkScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, EVIDENCE_PER_RESUME)
    .map(([ci, sim]) => ({
      section: chunks[ci].section,
      text: chunks[ci].text,
      similarity: sim
    }))

  return { semantic, evidence }
}

/**
 * Fraction of the JD's required skills the candidate has. A JD with no
 * recognised skills counts as fully satisfied rather than zeroing out a quarter
 * of everyone's score.
 */
export function skillOverlap(required: string[], candidate: Set<string>): number {
  if (required.length === 0) return 1
  return required.filter((s) => candidate.has(s)).length / required.length
}

export function blend(semantic: number, lexical: number, skills: number): number {
  return WEIGHTS.semantic * semantic + WEIGHTS.lexical * lexical + WEIGHTS.skills * skills
}
