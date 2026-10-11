/**
 * Search orchestration: load candidates, embed the query, blend the three
 * signals. The scoring math itself lives in scoring.ts.
 *
 * Why blend rather than use embeddings alone: embeddings capture "this resume is
 * about the same kind of work", but exact wording and recognized aliases add
 * useful signals. None of these components verifies qualifications or enforces
 * eligibility; recruiters review the source evidence and job requirements.
 */
import {
  getDb,
  blobToVector,
  RESUME_ROW_COLUMNS,
  rowToSummary,
  type ResumeRow
} from '../db/index.js'
import { embedder } from '../embed/client.js'
import { extractSkills, skillLabels } from '../ingest/skills.js'
import {
  blend,
  buildFtsQuery,
  normalizeScores,
  parseRequirements,
  scoreSemantics,
  skillOverlap,
  type ScoredChunk
} from './scoring.js'
import type { MatchResult, SearchResponse, SectionKind } from '@shared/types.js'

/** Optional in-process evaluation hook; never sent through the renderer API. */
export interface SearchInspection {
  queries: string[]
  queryVectors: Float32Array[]
  candidates: Array<{ resumeId: number; chunks: ScoredChunk[]; semantic: number; lexical: number }>
}

function lexicalScores(jd: string): Map<number, number> {
  const scores = new Map<number, number>()
  const query = buildFtsQuery(jd)
  if (!query) return scores

  try {
    const rows = getDb()
      .prepare(
        'SELECT rowid AS id, bm25(resumes_fts) AS score FROM resumes_fts WHERE resumes_fts MATCH ?'
      )
      .all(query) as Array<{ id: number; score: number }>
    // FTS5 bm25() is negative, with better matches more negative. Flip it.
    for (const r of rows) scores.set(r.id, -r.score)
  } catch {
    // A malformed MATCH expression should degrade the blend, not fail the search.
    return new Map()
  }
  return scores
}

export async function search(
  jobDescription: string,
  limit = 50,
  inspect?: (inspection: SearchInspection) => void
): Promise<Omit<SearchResponse, 'sessionId'>> {
  const started = Date.now()
  const db = getDb()

  const resumeRows = db.prepare(`SELECT ${RESUME_ROW_COLUMNS} FROM resumes`).all() as ResumeRow[]
  if (resumeRows.length === 0) {
    return { results: [], requiredSkills: [], totalCandidates: 0, elapsedMs: Date.now() - started }
  }

  const requiredSkillIds = extractSkills(jobDescription)
  // The whole-JD vector anchors overall role similarity; the per-requirement
  // vectors let individual bullets be answered individually.
  const queries = [
    jobDescription,
    ...parseRequirements(jobDescription)
  ]
  const queryVectors = await embedder.embedQueries(queries)

  const chunkRows = db
    .prepare('SELECT resume_id, section, text, embedding FROM chunks')
    .all() as Array<{ resume_id: number; section: SectionKind; text: string; embedding: Buffer }>

  const byResume = new Map<number, ScoredChunk[]>()
  for (const row of chunkRows) {
    const rec: ScoredChunk = {
      section: row.section,
      text: row.text,
      vector: blobToVector(row.embedding)
    }
    const list = byResume.get(row.resume_id)
    if (list) list.push(rec)
    else byResume.set(row.resume_id, [rec])
  }

  const lexical = lexicalScores(jobDescription)

  const raws = resumeRows
    .map((row) => {
      const chunks = byResume.get(row.id) ?? []
      if (chunks.length === 0) return null

      const { semantic, evidence } = scoreSemantics(queryVectors, chunks)
      const candidateSkills = new Set(JSON.parse(row.skills_json) as string[])

      return {
        row,
        semantic,
        lexical: lexical.get(row.id) ?? 0,
        skills: skillOverlap(requiredSkillIds, candidateSkills),
        matched: requiredSkillIds.filter((s) => candidateSkills.has(s)),
        missing: requiredSkillIds.filter((s) => !candidateSkills.has(s)),
        evidence
      }
    })
    .filter((r) => r !== null)

  const semanticN = normalizeScores(raws.map((r) => r.semantic))
  const lexicalN = normalizeScores(raws.map((r) => r.lexical))

  const results: MatchResult[] = raws
    .map((r, i) => ({
      resume: rowToSummary(r.row),
      score: blend(semanticN[i], lexicalN[i], r.skills),
      breakdown: { semantic: semanticN[i], lexical: lexicalN[i], skills: r.skills },
      matchedSkills: skillLabels(r.matched),
      missingSkills: skillLabels(r.missing),
      evidence: r.evidence
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  const elapsedMs = Date.now() - started
  inspect?.({ queries, queryVectors, candidates: raws.map((r) => ({
    resumeId: r.row.id, chunks: byResume.get(r.row.id)!, semantic: r.semantic, lexical: r.lexical
  })) })

  return {
    results,
    requiredSkills: skillLabels(requiredSkillIds),
    totalCandidates: raws.length,
    elapsedMs
  }
}
