/**
 * End-to-end retrieval quality, with the real model and no mocks.
 *
 * This is the guard against a silently broken pipeline: every unit test can pass
 * while the app returns nonsense, because the failure modes that matter here are
 * things like forgetting the query prefix, or chunking so badly the vectors stop
 * meaning anything. Three professions that share almost no vocabulary make that
 * kind of breakage impossible to miss.
 *
 * Runs the real pipeline minus SQLite, because better-sqlite3 is compiled against
 * Electron's ABI, so it cannot be loaded from plain Node.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'
import { resolve } from 'node:path'
import { normalizeText } from '../src/main/ingest/normalize.js'
import { splitSections } from '../src/main/ingest/sections.js'
import { chunkSections } from '../src/main/ingest/chunk.js'
import { extractSkills } from '../src/main/ingest/skills.js'
import { MODEL_ID, PASSAGE_PREFIX, QUERY_PREFIX } from '../src/main/embed/protocol.js'
import {
  blend,
  normalizeScores,
  parseRequirements,
  scoreSemantics,
  skillOverlap,
  type ScoredChunk
} from '../src/main/search/scoring.js'
import {
  ARABIC_JOB_DESCRIPTIONS,
  ARABIC_RESUMES,
  JOB_DESCRIPTIONS,
  RESUMES,
  type Profession
} from './fixtures/corpus.js'

env.allowRemoteModels = false
env.localModelPath = resolve(__dirname, '../resources/models')

let extractor: FeatureExtractionPipeline

async function embed(texts: string[]): Promise<Float32Array[]> {
  const out = await extractor(texts, { pooling: 'mean', normalize: true })
  const flat = out.data as Float32Array
  const dim = flat.length / texts.length
  return texts.map((_, i) => new Float32Array(flat.slice(i * dim, (i + 1) * dim)))
}

interface Indexed {
  id: string
  profession: Profession
  chunks: ScoredChunk[]
  skills: Set<string>
}

const index: Indexed[] = []

beforeAll(async () => {
  extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' })

  for (const fixture of [...RESUMES, ...ARABIC_RESUMES]) {
    const text = normalizeText(fixture.text)
    const chunks = chunkSections(splitSections(text))
    const vectors = await embed(chunks.map((c) => PASSAGE_PREFIX + c.text))
    index.push({
      id: fixture.id,
      profession: fixture.profession,
      chunks: chunks.map((c, i) => ({ section: c.section, text: c.text, vector: vectors[i] })),
      skills: new Set(extractSkills(text))
    })
  }
})

/** Mirrors rank.ts, minus the BM25 term. */
async function rank(jd: string): Promise<Array<{ id: string; profession: Profession; score: number }>> {
  const required = extractSkills(jd)
  const queryTexts = [jd, ...parseRequirements(jd)]
  const queryVectors = await embed(queryTexts.map((t) => QUERY_PREFIX + t))

  const raw = index.map((entry) => ({
    entry,
    semantic: scoreSemantics(queryVectors, entry.chunks).semantic,
    skills: skillOverlap(required, entry.skills)
  }))

  const semanticN = normalizeScores(raw.map((r) => r.semantic))

  return raw
    .map((r, i) => ({
      id: r.entry.id,
      profession: r.entry.profession,
      // Lexical is held constant across candidates here, so it cannot bias the order.
      score: blend(semanticN[i], 0, r.skills)
    }))
    .sort((a, b) => b.score - a.score)
}

describe('ranking sanity', () => {
  it('indexes every fixture into at least one chunk', () => {
    expect(index).toHaveLength(RESUMES.length + ARABIC_RESUMES.length)
    for (const entry of index) expect(entry.chunks.length).toBeGreaterThan(0)
  })

  for (const profession of ['backend', 'nurse', 'accountant'] as const) {
    it(`puts only ${profession} resumes in the top 3 for the ${profession} posting`, async () => {
      const ranked = await rank(JOB_DESCRIPTIONS[profession])
      const top3 = ranked.slice(0, 3)
      expect(top3.map((r) => r.profession)).toEqual([profession, profession, profession])
    })

    it(`scores every ${profession} resume above every non-${profession} one`, async () => {
      const ranked = await rank(JOB_DESCRIPTIONS[profession])
      const worstMatching = Math.min(
        ...ranked.filter((r) => r.profession === profession).map((r) => r.score)
      )
      const bestOther = Math.max(
        ...ranked.filter((r) => r.profession !== profession).map((r) => r.score)
      )
      expect(worstMatching).toBeGreaterThan(bestOther)
    })
  }

  it('ranks the best-fitting candidate within a profession first', async () => {
    // Cross-profession separation is easy; this is the harder question. The
    // backend posting asks for Go, Kubernetes, PostgreSQL, AWS and IaC, and be-1
    // is the only candidate covering all of them, so it must beat the other
    // backend engineers rather than merely beating the nurses.
    const ranked = await rank(JOB_DESCRIPTIONS.backend)
    const backendOrder = ranked.filter((r) => r.profession === 'backend').map((r) => r.id)
    expect(backendOrder[0]).toBe('be-1')
  })

  it('separates the winner from the field by a clear margin', async () => {
    const ranked = await rank(JOB_DESCRIPTIONS.backend)
    const bestNonBackend = Math.max(
      ...ranked.filter((r) => r.profession !== 'backend').map((r) => r.score)
    )
    // A pipeline that has quietly stopped working tends to return near-identical
    // scores for everything, so require real separation rather than just order.
    expect(ranked[0].score - bestNonBackend).toBeGreaterThan(0.2)
  })

  it('degrades gracefully when the job description mentions no known skills', async () => {
    const ranked = await rank('We need a hardworking person who is a great team player.')
    expect(ranked).toHaveLength(RESUMES.length + ARABIC_RESUMES.length)
    expect(ranked.every((r) => Number.isFinite(r.score))).toBe(true)
  })
})

describe('multilingual retrieval', () => {
  // The app is Arabic-named, so Arabic CVs are a first-class case rather than an
  // edge case. The previous English-only model tokenised Arabic into fragments,
  // which these tests exist to stop regressing.
  for (const profession of ['backend', 'nurse', 'accountant'] as const) {
    it(`ranks the Arabic ${profession} CV first for the Arabic ${profession} posting`, async () => {
      const ranked = await rank(ARABIC_JOB_DESCRIPTIONS[profession])
      expect(ranked[0].profession).toBe(profession)
    })
  }

  it('retrieves across languages: an English posting finds the Arabic CV', async () => {
    // Not merely "somewhere in the list": the Arabic backend CV must outrank
    // every resume from a different profession, in either language.
    const ranked = await rank(JOB_DESCRIPTIONS.backend)
    const arabicBackend = ranked.findIndex((r) => r.id === 'ar-be')
    const bestOtherProfession = ranked.findIndex((r) => r.profession !== 'backend')
    expect(arabicBackend).toBeLessThan(bestOtherProfession)
  })

  it('retrieves across languages: an Arabic posting finds the English CVs', async () => {
    const ranked = await rank(ARABIC_JOB_DESCRIPTIONS.nurse)
    const top3 = ranked.slice(0, 3)
    expect(top3.every((r) => r.profession === 'nurse')).toBe(true)
    // and the set spans both languages rather than clustering by script
    expect(top3.some((r) => r.id.startsWith('ar-'))).toBe(true)
    expect(top3.some((r) => !r.id.startsWith('ar-'))).toBe(true)
  })
})
