import { describe, expect, it } from 'vitest'
import { suggestSemanticCriterionEvidence } from '../src/main/recruiting/planning.js'
import type { JobCriterion } from '../src/shared/recruiting.js'
import type { ScoredChunk } from '../src/main/search/scoring.js'

const criterion: JobCriterion = { id: 'pigments', text: 'Review pigment deterioration', importance: 'unspecified' }
const query = new Float32Array([1, 0])
const career: ScoredChunk = {
  section: 'experience',
  text: 'أشرفت على ترميم اللوحات الجدارية التاريخية وتوثيق حالة الأصباغ بالتعاون مع فريق المتحف.',
  vector: new Float32Array([0.8, 0.6])
}

describe('requirement evidence passage selection', () => {
  it('omits a tiny leading identity even when its model similarity exceeds real work evidence', () => {
    const name: ScoredChunk = { section: 'other', text: 'سلمى نور', vector: new Float32Array([1, 0]) }
    const passages = [name, career]
    const result = suggestSemanticCriterionEvidence([criterion], passages, [query])[0]
    expect(result.passage?.text).toBe(career.text)
    expect(result.reviewNeeded).toBe(true)
    expect(passages).toEqual([name, career])
  })

  it('retains short education and skills credentials beside a substantive career passage', () => {
    for (const section of ['education', 'skills'] as const) {
      const credential: ScoredChunk = { section, text: 'ICOMOS', vector: new Float32Array([1, 0]) }
      expect(suggestSemanticCriterionEvidence([criterion], [credential, career], [query])[0].passage?.text).toBe('ICOMOS')
    }
  })

  it('does not erase sparse CVs or short unstructured evidence later in a CV', () => {
    const brief: ScoredChunk = { section: 'other', text: 'ICOMOS conservator', vector: new Float32Array([1, 0]) }
    expect(suggestSemanticCriterionEvidence([criterion], [brief], [query])[0].passage?.text).toBe(brief.text)
    expect(suggestSemanticCriterionEvidence([criterion], [career, brief], [query])[0].passage?.text).toBe(brief.text)
  })
})
