import { describe, expect, it } from 'vitest'
import { criterionImportanceLabel, extractJobRequirements, splitRequirementClauses, stripRequirementBullet } from '../src/shared/job-requirements.js'
import type { JobCriterion, JobPosting } from '../src/shared/recruiting.js'
import { jobRecordSchema, recruitingSchemas } from '../src/main/recruiting/schema.js'
import { suggestSemanticCriterionEvidence } from '../src/main/recruiting/planning.js'

const posting = (values: Partial<JobPosting> = {}): JobPosting => ({ position: '', jobDescription: '', requirements: '', educationAndCertifications: '', ...values })
const criterion: JobCriterion = { id: 'credential', text: 'Accredited conservation of wall paintings', importance: 'unspecified' }

describe('vacancy-specific requirement drafts', () => {
  it('retains unfamiliar terminology and short credentials independently of the dictionary', () => {
    const result = extractJobRequirements(posting({ requirements: 'CFA\nICOMOS\nترميم المخطوطات\nC#' }))
    expect(result.requirements.map(({ text, importance }) => [text, importance])).toEqual([
      ['CFA', 'unspecified'], ['ICOMOS', 'unspecified'], ['ترميم المخطوطات', 'unspecified'], ['C#', 'unspecified']
    ])
  })

  it('uses explicit English headings and modals but does not invent priority for generic headings', () => {
    const result = extractJobRequirements(posting({ requirements: 'Required qualifications:\nCFA\nPreferred skills:\nArt conservation\nResponsibilities:\nCoordinate restoration\nMust hold a current license\nCAD preferred' }))
    expect(result.requirements.map(({ importance }) => importance)).toEqual(['required', 'preferred', 'unspecified', 'required', 'preferred'])
  })

  it('handles Arabic headings, explicit importance, and mixed-script bullets', () => {
    const result = extractJobRequirements(posting({ requirements: 'المتطلبات الإلزامية:\n١. ترخيص مهني\nالمؤهلات المفضلة:\n• GIS\nالمهام:\nإدارة السجلات\nيُفضل تحليل الخرائط\nيجب مراجعة المخططات' }))
    expect(result.requirements.map(({ text }) => text)).toEqual(['ترخيص مهني', 'GIS', 'إدارة السجلات', 'يُفضل تحليل الخرائط', 'يجب مراجعة المخططات'])
    expect(result.requirements.map(({ importance }) => importance)).toEqual(['required', 'preferred', 'unspecified', 'preferred', 'required'])
  })

  it('does not strip decimal quantities, signed values or word-leading symbols as bullets', () => {
    const values = ['10.5 years of practice', '٣.٥ سنوات من الخبرة', '-5 degrees storage experience', '*nix administration']
    for (const value of values) expect(stripRequirementBullet(value)).toBe(value)
    for (const marker of ['1. ', '٢) ', '- ', '* ', '•', '▪ ', '◦']) {
      expect(stripRequirementBullet(`${marker}10.5 years of practice`)).toBe('10.5 years of practice')
    }
    expect(extractJobRequirements(posting({ requirements: values.join('\n') })).requirements.map(({ text }) => text)).toEqual(values)
  })

  it('preserves exact source wording while producing editable bullet text', () => {
    const source = '• Must oversee mural conservation.'
    const result = extractJobRequirements(posting({ jobDescription: source }))
    expect(result.requirements).toEqual([{ text: 'Must oversee mural conservation.', importance: 'required', source: { field: 'jobDescription', text: source } }])
    const corrected = { ...result.requirements[0], text: 'Oversee fresco conservation' }
    expect(corrected.source?.text).toBe(source)
  })

  it('does not promote negated or contradictory obligations into must-haves', () => {
    const result = extractJobRequirements(posting({ requirements: 'Required:\nA degree is not required\nترخيص غير مطلوب\nCertification required or preferred\nResponsibilities:\nMustard production\nExperience with mustard preferred' }))
    expect(result.requirements.map(({ importance }) => importance)).toEqual(['unspecified', 'unspecified', 'unspecified', 'unspecified', 'preferred'])
  })

  it('leaves separated English and Arabic negations unclassified even under mandatory headings', () => {
    const lines = [
      'No certification is required', 'Certification is not a mandatory qualification',
      'A degree is not necessarily required', 'Previous practice isn’t required',
      'A licence is not required but field experience is essential',
      'لا توجد شهادة مطلوبة', 'ليست الشهادة شرطاً إلزامياً',
      'مطلوب تدريب ولكن لا يشترط ترخيص'
    ]
    const result = extractJobRequirements(posting({ requirements: `Required:\n${lines.join('\n')}` }))
    expect(result.requirements.map(({ text }) => text)).toEqual(lines)
    expect(result.requirements.every(({ importance }) => importance === 'unspecified')).toBe(true)
    expect(extractJobRequirements(posting({ requirements: 'No-dig excavation experience required' })).requirements[0].importance).toBe('required')
  })

  it('retains degree abbreviations, examples and qualification alternatives as complete clauses', () => {
    expect(splitRequirementClauses('B.Sc. or equivalent required. M.Eng. preferred.')).toEqual([
      'B.Sc. or equivalent required.', 'M.Eng. preferred.'
    ])
    expect(splitRequirementClauses('Relevant examples, e.g. mural conservation. Ph.D. or equivalent research experience preferred.')).toEqual([
      'Relevant examples, e.g. mural conservation.', 'Ph.D. or equivalent research experience preferred.'
    ])
    expect(splitRequirementClauses('A relevant degree. Or equivalent professional practice. Experience required.')).toEqual([
      'A relevant degree. Or equivalent professional practice.', 'Experience required.'
    ])
    expect(splitRequirementClauses('شهادة مهنية؛ أو خبرة عملية معادلة. يفضل توثيق المقتنيات.')).toEqual([
      'شهادة مهنية؛ أو خبرة عملية معادلة.', 'يفضل توثيق المقتنيات.'
    ])
    const result = extractJobRequirements(posting({ educationAndCertifications: 'B.Sc. or equivalent required. M.Eng. preferred.' }))
    expect(result.requirements.map(({ text, importance }) => [text, importance])).toEqual([
      ['B.Sc. or equivalent required.', 'required'], ['M.Eng. preferred.', 'preferred']
    ])
  })

  it('applies inline heading scope through following clauses until the next heading', () => {
    const result = extractJobRequirements(posting({ requirements: [
      'Required:', 'Preferred: archival cataloguing. Conservation training.', 'Collection photography',
      'Responsibilities: Preserve manuscripts. Document condition.',
      'المؤهلات المفضلة: ترميم الورق. توثيق الأحبار.',
      'Required: Licence. Preferred: Research experience. Field publications.'
    ].join('\n') }))
    expect(result.requirements.map(({ importance }) => importance)).toEqual([
      'preferred', 'preferred', 'preferred', 'unspecified', 'unspecified',
      'preferred', 'preferred', 'required', 'preferred', 'preferred'
    ])
  })

  it('does not propagate an ambiguous inline priority to later sentences', () => {
    const result = extractJobRequirements(posting({ requirements: 'Required:\nPreferred: a degree is not essential. Museum practice.\nRequired: certification required or preferred. Field research.' }))
    expect(result.requirements.map(({ importance }) => importance)).toEqual(['unspecified', 'unspecified', 'unspecified', 'unspecified'])
  })

  it('keeps paragraph siblings independently traceable to exact source clauses', () => {
    const source = '• Preferred: Map aquifers.  Validate borehole logs.'
    const result = extractJobRequirements(posting({ requirements: source }))
    expect(result.requirements.map(({ source: origin }) => origin)).toEqual([
      { field: 'requirements', text: 'Preferred: Map aquifers.' },
      { field: 'requirements', text: 'Validate borehole logs.' }
    ])
    for (const requirement of result.requirements) expect(source).toContain(requirement.source!.text)
    const edited = { ...result.requirements[0], text: 'Map groundwater systems' }
    expect(edited.source?.text).toBe('Preferred: Map aquifers.')
  })

  it('reads all content fields and resets inherited importance between fields', () => {
    const result = extractJobRequirements(posting({ position: 'Archivist', requirements: 'Required:\nCataloguing', educationAndCertifications: 'Degree in history', jobDescription: 'Preserve fragile manuscripts' }))
    expect(result.requirements.map(({ importance }) => importance)).toEqual(['required', 'unspecified', 'unspecified'])
    expect(result.requirements.map(({ source }) => source?.field)).toEqual(['requirements', 'educationAndCertifications', 'jobDescription'])
  })

  it('reports omitted requirements and never silently clips their qualification wording', () => {
    const result = extractJobRequirements(posting({ requirements: [...Array.from({ length: 42 }, (_, i) => `Requirement ${i}`), 'x'.repeat(1001)].join('\n') }))
    expect(result.requirements).toHaveLength(40)
    expect(result.omitted).toBe(3)
  })

  it('deduplicates repeated requirement text and leaves the posting unchanged', () => {
    const original = posting({ jobDescription: 'Map aquifers', requirements: 'Map aquifers\n\nMap aquifers' })
    const before = JSON.stringify(original)
    expect(extractJobRequirements(original).requirements).toHaveLength(1)
    expect(JSON.stringify(original)).toBe(before)
    expect(criterionImportanceLabel('unspecified')).toBe('Unspecified')
  })

  it('skips company and benefit sections until another requirement heading', () => {
    const result = extractJobRequirements(posting({ jobDescription: 'About us:\nWe preserve global heritage\nBenefits:\nWe offer flexible hours\nResponsibilities:\nPreserve fragile manuscripts\nالمزايا:\nتأمين طبي\nالمتطلبات:\nتوثيق المقتنيات' }))
    expect(result.requirements.map(({ text }) => text)).toEqual(['Preserve fragile manuscripts', 'توثيق المقتنيات'])
  })

  it('does not emit source excerpts that cannot pass the storage contract', () => {
    const result = extractJobRequirements(posting({ requirements: `${'A short sentence. '.repeat(2_000)}Final requirement.` }))
    expect(result.requirements).toEqual([])
    expect(result.omitted).toBeGreaterThan(0)
  })
})

describe('requirement contracts and compatibility', () => {
  it('accepts the new state and provenance while preserving legacy jobs byte-for-byte', () => {
    const legacy = { id: '4a586adb-aab7-4f27-9018-7027936179c7', posting: posting({ position: 'Archivist' }), status: 'open', criteria: [{ ...criterion, importance: 'required' }], createdAt: 1, updatedAt: 1, lastSearchedAt: null }
    expect(JSON.stringify(jobRecordSchema.parse(legacy))).toBe(JSON.stringify(legacy))
    expect(recruitingSchemas.saveJob.safeParse({ posting: legacy.posting, status: 'open', criteria: [{ ...criterion, source: { field: 'requirements', text: 'Original criterion' } }] }).success).toBe(true)
  })

  it('rejects malformed, forged, oversized and NUL-containing provenance', () => {
    const valid = { posting: posting({ position: 'Archivist' }), status: 'open', criteria: [criterion] }
    for (const source of [
      { field: 'position', text: 'Title' }, { field: 'requirements', text: '' }, { field: 'requirements', text: 'x'.repeat(30_001) },
      { field: 'requirements', text: 'invalid\0text' }, { field: 'requirements', text: 'Original', verified: true }
    ]) expect(recruitingSchemas.saveJob.safeParse({ ...valid, criteria: [{ ...criterion, source }] }).success).toBe(false)
  })
})

describe('requirement passage retrieval', () => {
  it('retrieves a different-language passage from vectors and always leaves the assessment for review', () => {
    const passage = 'أشرفت على ترميم اللوحات الجدارية التاريخية مع فريق المتحف.'
    const result = suggestSemanticCriterionEvidence([criterion], [
      { section: 'experience', text: passage, vector: new Float32Array([1, 0]) },
      { section: 'experience', text: 'Accredited conservation courses only; no professional practice.', vector: new Float32Array([0, 1]) }
    ], [new Float32Array([1, 0])])
    expect(result).toEqual([{ criterionId: criterion.id, method: 'semantic', reviewNeeded: true, passage: { section: 'experience', text: passage, similarity: 1 } }])
    expect(result[0]).not.toHaveProperty('status')
  })

  it('uses production section weighting without claiming that a course or negation proves experience', () => {
    const text = 'I have never overseen wall painting conservation.'
    const result = suggestSemanticCriterionEvidence([criterion], [
      { section: 'summary', text: criterion.text, vector: new Float32Array([1, 0]) },
      { section: 'experience', text, vector: new Float32Array([0.98, 0.2]) }
    ], [new Float32Array([1, 0])])
    expect(result[0].passage?.text).toBe(text)
    expect(result[0].reviewNeeded).toBe(true)
    expect(result[0]).not.toHaveProperty('status')
  })

  it('returns no passage when a CV has no indexed text, and rejects incompatible vectors', () => {
    expect(suggestSemanticCriterionEvidence([criterion], [], [new Float32Array([1, 0])])[0].passage).toBeNull()
    expect(() => suggestSemanticCriterionEvidence([criterion], [], [])).toThrow('do not match')
    expect(() => suggestSemanticCriterionEvidence([criterion], [{ section: 'other', text: 'Example', vector: new Float32Array([1]) }], [new Float32Array([1, 0])])).toThrow('incompatible')
  })
})
