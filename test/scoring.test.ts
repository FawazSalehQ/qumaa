import { describe, it, expect } from 'vitest'
import {
  blend,
  buildFtsQuery,
  cosine,
  normalizeScores,
  parseRequirements,
  scoreSemantics,
  skillOverlap,
  WEIGHTS,
  type ScoredChunk
} from '../src/main/search/scoring.js'

const vec = (...xs: number[]): Float32Array => new Float32Array(xs)

describe('cosine', () => {
  it('is 1 for identical unit vectors', () => {
    expect(cosine(vec(1, 0, 0), vec(1, 0, 0))).toBeCloseTo(1)
  })

  it('is 0 for orthogonal vectors', () => {
    expect(cosine(vec(1, 0, 0), vec(0, 1, 0))).toBeCloseTo(0)
  })

  it('is -1 for opposed vectors', () => {
    expect(cosine(vec(1, 0), vec(-1, 0))).toBeCloseTo(-1)
  })

  it('matches a hand-computed value', () => {
    // (0.6, 0.8) · (0.8, 0.6) = 0.48 + 0.48
    expect(cosine(vec(0.6, 0.8), vec(0.8, 0.6))).toBeCloseTo(0.96)
  })
})

describe('normalizeScores', () => {
  it('maps the pool onto 0..1', () => {
    expect(normalizeScores([1, 2, 3])).toEqual([0, 0.5, 1])
  })

  it('handles an all-equal pool without dividing by zero', () => {
    expect(normalizeScores([0.7, 0.7, 0.7])).toEqual([1, 1, 1])
  })

  it('returns an empty array unchanged', () => {
    expect(normalizeScores([])).toEqual([])
  })
})

describe('parseRequirements', () => {
  it('treats each bullet as its own requirement', () => {
    const reqs = parseRequirements('• Five years of Python\n• Experience with Kubernetes\n• AWS')
    expect(reqs).toContain('Five years of Python')
    expect(reqs).toContain('Experience with Kubernetes')
  })

  it('drops fragments too short to mean anything', () => {
    expect(parseRequirements('Python\nGo\nAWS')).toEqual([])
  })

  it('splits long prose into sentences', () => {
    const prose =
      'We are looking for a backend engineer to join our platform team in London. ' +
      'You will design and operate distributed services at significant scale. ' +
      'Deep knowledge of Kubernetes and cloud infrastructure is essential here.'
    const reqs = parseRequirements(prose)
    expect(reqs.length).toBeGreaterThanOrEqual(3)
  })

  it('caps the number of requirements so a huge JD cannot blow up the search', () => {
    const jd = Array.from({ length: 200 }, (_, i) => `Requirement number ${i} here`).join('\n')
    expect(parseRequirements(jd).length).toBeLessThanOrEqual(40)
  })
})

describe('buildFtsQuery', () => {
  it('ORs salient terms together', () => {
    const q = buildFtsQuery('Kubernetes and Python')
    expect(q).toBe('"kubernetes" OR "python"')
  })

  it('drops stopwords and very short tokens', () => {
    expect(buildFtsQuery('the and for we')).toBeNull()
  })

  it('quotes every term so FTS5 cannot read punctuation as syntax', () => {
    const q = buildFtsQuery('node.js developer')
    expect(q).toContain('"node.js"')
  })

  it('deduplicates repeated terms', () => {
    expect(buildFtsQuery('python python python')).toBe('"python"')
  })

})

describe('skillOverlap', () => {
  it('is the fraction of required skills present', () => {
    expect(skillOverlap(['a', 'b', 'c', 'd'], new Set(['a', 'b']))).toBe(0.5)
  })

  it('treats a JD with no recognised skills as satisfied', () => {
    // Otherwise every candidate loses 25% of their score for a vague posting.
    expect(skillOverlap([], new Set(['a']))).toBe(1)
  })

  it('is 0 when nothing matches', () => {
    expect(skillOverlap(['a'], new Set(['z']))).toBe(0)
  })
})

describe('scoreSemantics', () => {
  const chunk = (v: Float32Array, text = 't'): ScoredChunk => ({ section: 'other', text, vector: v })

  it('averages the best chunk per query', () => {
    // Query A matches chunk 1 perfectly, query B matches chunk 2 perfectly.
    const result = scoreSemantics(
      [vec(1, 0), vec(0, 1)],
      [chunk(vec(1, 0), 'first'), chunk(vec(0, 1), 'second')]
    )
    expect(result.semantic).toBeCloseTo(1)
  })

  it('credits covering many requirements over nailing only one', () => {
    const queries = [vec(1, 0), vec(0, 1)]
    const broad = scoreSemantics(queries, [chunk(vec(1, 0)), chunk(vec(0, 1))])
    const narrow = scoreSemantics(queries, [chunk(vec(1, 0)), chunk(vec(1, 0))])
    expect(broad.semantic).toBeGreaterThan(narrow.semantic)
  })

  it('returns evidence ordered by similarity', () => {
    const { evidence } = scoreSemantics(
      [vec(1, 0), vec(1, 0)],
      [chunk(vec(0, 1), 'weak'), chunk(vec(1, 0), 'strong')]
    )
    expect(evidence[0].text).toBe('strong')
  })

  it('caps evidence at three passages', () => {
    const chunks = Array.from({ length: 10 }, (_, i) => chunk(vec(1, 0), `c${i}`))
    expect(scoreSemantics([vec(1, 0), vec(1, 0)], chunks).evidence).toHaveLength(3)
  })

  it('handles a resume with no chunks without throwing', () => {
    expect(scoreSemantics([vec(1, 0)], [])).toEqual({ semantic: 0, evidence: [] })
  })
})

describe('blend', () => {
  it('applies the configured weights', () => {
    expect(blend(1, 1, 1)).toBeCloseTo(1)
    expect(blend(1, 0, 0)).toBeCloseTo(WEIGHTS.semantic)
    expect(blend(0, 0, 1)).toBeCloseTo(WEIGHTS.skills)
  })

  it('has weights that sum to 1', () => {
    expect(WEIGHTS.semantic + WEIGHTS.lexical + WEIGHTS.skills).toBeCloseTo(1)
  })
})
