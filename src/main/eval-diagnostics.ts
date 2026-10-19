/** Opt-in, local evaluation diagnostics. Never exposed through the renderer API. */
import { getDb } from './db/index.js'
import { buildFtsQuery, cosine, parseRequirements, scoreSemantics } from './search/scoring.js'
import { lexicalScores, type SearchInspection } from './search/rank.js'
import type { SectionKind } from '@shared/types.js'
import { extractSkills } from './ingest/skills.js'

/** Freeze identical parsed inputs for model-only experiments outside the app. */
export function modelBenchmarkInput(posting: string) {
  const db = getDb()
  const lexical = lexicalScores(posting)
  const chunks = db.prepare('SELECT section, text FROM chunks WHERE resume_id = ? ORDER BY ordinal')
  return {
    queries: [posting, ...parseRequirements(posting)],
    requiredSkills: extractSkills(posting),
    candidates: (db.prepare('SELECT id, skills_json FROM resumes ORDER BY id').all() as Array<{ id: number; skills_json: string }>).map((row) => ({
      id: row.id,
      skills: JSON.parse(row.skills_json) as string[],
      lexical: lexical.get(row.id) ?? 0,
      chunks: chunks.all(row.id) as Array<{ section: SectionKind; text: string }>
    }))
  }
}

/** Contains source passages; keep results private when evaluating real CVs. */
export function diagnoseSearch(inspection: SearchInspection): {
  queries: string[]
  lexicalQuery: string | null
  candidates: Array<{
    resumeId: number
    semantic: number
    lexical: number
    requirements: Array<{ query: number; weighted: number; cosine: number; section: SectionKind; text: string }>
  }>
} {
  const { queries, queryVectors: vectors, candidates } = inspection
  return {
    queries,
    lexicalQuery: buildFtsQuery(queries[0]),
    candidates: candidates.map(({ resumeId, chunks, semantic, lexical }) => ({
      resumeId,
      semantic,
      lexical,
      requirements: vectors.map((vector, query) => {
        // Use the production scorer for its section weighting, not a copied
        // weight table that could drift from the code under evaluation.
        const best = chunks.map((chunk) => ({ chunk, weighted: scoreSemantics([vector], [chunk]).semantic }))
          .reduce((a, b) => a.weighted >= b.weighted ? a : b)
        return { query, weighted: best.weighted, cosine: cosine(vector, best.chunk.vector), section: best.chunk.section, text: best.chunk.text }
      })
    }))
  }
}
