import { describe, expect, it } from 'vitest'
import { careerLanguage, familySchema, languageRecall, macroMetrics, manifestSchema, type MetricCase } from '../src/main/eval-cross-domain-support'
import { rankingMetrics } from '../src/main/eval-support'

describe('cross-domain evaluation integrity', () => {
  it('uses one translation per career and complementary mixed assignments', () => {
    expect(Array.from({ length: 8 }, (_, i) => careerLanguage(i, 'mixed-a'))).toEqual(['en', 'ar', 'en', 'ar', 'en', 'ar', 'en', 'ar'])
    for (let i = 0; i < 8; i++) expect(careerLanguage(i, 'mixed-a')).not.toBe(careerLanguage(i, 'mixed-b'))
    expect(careerLanguage(3, 'english')).toBe('en')
    expect(careerLanguage(2, 'arabic')).toBe('ar')
  })
  it('weights vacancies equally rather than counting translations as independent jobs', () => {
    const good = rankingMetrics([1, 1, 1, 4, 4, 4], [1, 1, 1, 4, 4, 4])
    const bad = rankingMetrics([4, 4, 4, 1, 1, 1], [1, 1, 1, 4, 4, 4])
    const cases: MetricCase[] = [
      ...['a', 'b', 'c'].map((id) => ({ id, family: 'software', vacancy: 'one', language: 'en' as const, cohort: 'mixed-a' as const, metrics: good })),
      { id: 'd', family: 'legal', vacancy: 'one', language: 'ar', cohort: 'mixed-b', metrics: bad }
    ]
    expect(macroMetrics(cases).precisionAt3).toBe(0.5)
    expect(() => macroMetrics([...cases, cases[0]])).toThrow('Duplicate')
    expect(() => macroMetrics([])).toThrow('empty')
  })
  it('does not claim perfect language recall when no relevant CV uses that language', () => {
    expect(languageRecall([{ tier: 1, language: 'en' }], 'ar')).toEqual({ relevant: 0, hits3: 0, hits10: 0, recallAt3: null, recallAt10: null })
    const ranking = [...Array.from({ length: 3 }, () => ({ tier: 4 as const, language: 'en' as const })), { tier: 1 as const, language: 'ar' as const }]
    expect(languageRecall(ranking, 'ar')).toMatchObject({ relevant: 1, recallAt3: 0, recallAt10: 1 })
  })
  it('requires complete labels, rationales and independent reserved families', () => {
    const family = { schemaVersion: 1, family: 'sample', title: 'Sample', reviewStatus: 'synthetic-unreviewed',
      candidates: Array.from({ length: 8 }, (_, i) => ({ id: `C0${i + 1}`, en: `Career ${i}`, ar: `سيرة ${i}` })),
      vacancies: ['one', 'two'].map((id) => ({ id, seniority: 'experienced', posting: { en: 'Posting', ar: 'وظيفة' }, labels: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`C0${i + 1}`, i < 3 ? 1 : 4])), rationales: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`C0${i + 1}`, 'Rationale'])) })) }
    expect(familySchema.safeParse(family).success).toBe(true)
    expect(familySchema.safeParse({ ...family, candidates: [...family.candidates, family.candidates[0]] }).success).toBe(false)
    const incomplete = structuredClone(family)
    delete incomplete.vacancies[0].labels.C01
    expect(familySchema.safeParse(incomplete).success).toBe(false)
    expect(manifestSchema.safeParse({ schemaVersion: 1, id: 'suite', families: [{ family: 'one', split: 'development' }, { family: 'two', split: 'development' }] }).success).toBe(false)
  })
})
