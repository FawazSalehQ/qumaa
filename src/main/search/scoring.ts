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
  'requirements', 'responsibilities', 'preferred', 'plus', 'must', 'should', 'well',
  // Keep this conservative: connectives and generic recruitment wording, not
  // occupations, qualifications, locations, or domain terms.
  'في', 'من', 'على', 'إلى', 'الى', 'عن', 'مع', 'أن', 'ان', 'أو', 'او', 'هذا', 'هذه',
  'الذي', 'التي', 'نحن', 'بين', 'كما', 'لدى', 'ضمن', 'يجب', 'مطلوب', 'مطلوبة',
  'المطلوب', 'المطلوبة', 'وظيفة', 'الوظيفة', 'خبرة', 'الخبرة', 'سنوات', 'سنة',
  'المتطلبات', 'المسؤوليات', 'يفضل'
])

const MAX_FTS_TERMS = 60

/**
 * Builds an FTS5 MATCH expression from literal Unicode terms. Token spelling
 * agrees with the existing porter/unicode61 index; no query-only normalization
 * or translation is applied. The existing sixty-term prefix budget is retained.
 */
export function buildFtsQuery(jd: string): string | null {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const match of jd.toLowerCase().matchAll(/\p{L}[\p{L}\p{M}\p{N}+#.]*/gu)) {
    let end = match[0].length
    while (end > 0 && match[0][end - 1] === '.') end--
    const term = match[0].slice(0, end)
    const unmarked = term.replace(/\p{M}/gu, '')
    if (Array.from(unmarked).length < 3 || STOPWORDS.has(unmarked) || seen.has(term)) continue
    seen.add(term)
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

/**
 * How much a match in each section counts as *evidence*.
 *
 * A summary that restates the posting is a claim; the same claim inside a work
 * history is a demonstration. Without this the ranking is trivially gamed by
 * pasting the job description into a profile blurb, which is exactly what a
 * keyword-stuffed CV does — and what an evaluation over 100 resumes showed it
 * doing, with an HR administrator and a fresh graduate taking the top slots
 * from qualified candidates.
 *
 * `other` stays high on purpose. It is where the section splitter puts
 * unrecognised headings, and strong candidates who write their own headers land
 * there; penalising it would punish good CVs for unconventional formatting.
 */
const SECTION_WEIGHT: Record<SectionKind, number> = {
  experience: 1,
  projects: 1,
  other: 1,
  skills: 0.92,
  education: 0.92,
  summary: 0.88
}

interface SemanticResult {
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

  // Raw similarity is kept alongside the weighted one: ranking should use the
  // discounted value, but the evidence shown to a user should report how well
  // the passage actually matched, not a number adjusted for where it sat.
  const bestChunkRaw = new Map<number, number>()

  queryVectors.forEach((qv, qi) => {
    let best = -Infinity
    chunks.forEach((chunk, ci) => {
      const raw = cosine(qv, chunk.vector)
      const sim = raw * SECTION_WEIGHT[chunk.section]
      if (sim > best) best = sim
      if (qi >= evidenceStart) {
        const prev = bestChunkScore.get(ci)
        if (prev === undefined || sim > prev) {
          bestChunkScore.set(ci, sim)
          bestChunkRaw.set(ci, raw)
        }
      }
    })
    perQueryBest.push(best)
  })

  const semantic = perQueryBest.reduce((a, b) => a + b, 0) / perQueryBest.length

  const evidence: Evidence[] = [...bestChunkScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, EVIDENCE_PER_RESUME)
    .map(([ci]) => ({
      section: chunks[ci].section,
      text: chunks[ci].text,
      similarity: bestChunkRaw.get(ci) ?? 0
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
