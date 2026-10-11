import { describe, expect, it } from 'vitest'
import { buildFtsQuery } from '../src/main/search/scoring.js'

describe('multilingual lexical queries', () => {
  it('retains Arabic occupation and domain terms while omitting generic recruiting text', () => {
    expect(buildFtsQuery('مطلوب مهندس حفر لديه خبرة في النفط والغاز لسنوات متعددة'))
      .toBe('"مهندس" OR "حفر" OR "لديه" OR "النفط" OR "والغاز" OR "لسنوات" OR "متعددة"')
  })

  it('retains English acronyms in a mixed Arabic posting and deduplicates exact terms', () => {
    expect(buildFtsQuery('مهندس حفر IWCF BOP مهندس iwcf with experience'))
      .toBe('"مهندس" OR "حفر" OR "iwcf" OR "bop"')
  })

  it('keeps meaningful English terms and dotted technology phrases unchanged', () => {
    expect(buildFtsQuery('Required: Node.js, C++, SQL, AWS and Kubernetes.'))
      .toBe('"node.js" OR "c++" OR "sql" OR "aws" OR "kubernetes"')
  })

  it('preserves Unicode spellings and marks for the same tokenizer used by the index', () => {
    expect(buildFtsQuery('حَفْر حفر الآبار آبار pétrole cafe\u0301 خِبرة'))
      .toBe('"حَفْر" OR "حفر" OR "الآبار" OR "آبار" OR "pétrole" OR "café"')
  })

  it('does not let quotes, punctuation, or FTS operators become query syntax', () => {
    expect(buildFtsQuery('"حفر" OR NEAR(نفط، غاز) -Python* {drilling}:engineer'))
      .toBe('"حفر" OR "near" OR "نفط" OR "غاز" OR "python" OR "drilling" OR "engineer"')
  })

  it('returns null for stopwords, numbers, or punctuation without meaningful terms', () => {
    expect(buildFtsQuery('هذا مطلوب في وظيفة خبرة سنوات مع the and for ٢٠٢٦ 2026 " * +')).toBeNull()
  })

  it('caps unique multilingual terms while repeated words do not consume the budget', () => {
    const terms = Array.from({ length: 100 }, (_, i) => `مهارة${i}`)
    const query = buildFtsQuery(`خبرة ${terms.flatMap((term) => [term, term]).join(' ')}`)!
    expect(query.split(' OR ')).toHaveLength(60)
    expect(new Set(query.split(' OR ')).size).toBe(60)
    expect(query).toContain('"مهارة0"')
    expect(query).toContain('"مهارة59"')
    expect(query).not.toContain('"مهارة60"')
  })

})
