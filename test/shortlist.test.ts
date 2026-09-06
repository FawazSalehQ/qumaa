import { describe, expect, it, vi } from 'vitest'
import type { MatchResult } from '../src/shared/types.js'

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))

import { shortlistHtml } from '../src/main/export/shortlist.js'
import { shortlistCsv } from '../src/main/export/shortlist-csv.js'

function result(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    resume: {
      id: 1,
      recordKey: 'a'.repeat(64),
      fileName: 'candidate.pdf',
      filePath: '/candidate.pdf',
      importedAt: 1,
      name: 'Candidate One',
      email: 'candidate@example.com',
      phone: null,
      location: 'Riyadh',
      yearsExperience: 7,
      educationLevel: 'bachelors',
      skills: ['Training']
    },
    score: 0.91,
    breakdown: { semantic: 0.9, lexical: 0.8, skills: 1 },
    matchedSkills: ['Training'],
    missingSkills: [],
    evidence: [{ section: 'experience', text: 'Led training programs.', similarity: 0.9 }],
    ...overrides
  }
}

describe('shortlistHtml', () => {
  it('renders every ranked result in order', () => {
    const html = shortlistHtml({
      jobTitle: 'Training Manager',
      requiredSkills: ['Training'],
      results: [
        result(),
        result({
          resume: { ...result().resume, id: 2, name: 'Candidate Two' },
          score: 0.82
        })
      ],
      generatedAt: new Date('2026-08-28T00:00:00Z')
    })

    expect(html).toContain('Candidate One')
    expect(html).toContain('Candidate Two')
    expect(html.indexOf('Candidate One')).toBeLessThan(html.indexOf('Candidate Two'))
    expect(html.match(/class="candidate"/g)).toHaveLength(2)
  })

  it('escapes all resume and posting content before loading it into Electron', () => {
    const payload = '<script>window.pwned = true</script>'
    const html = shortlistHtml({
      jobTitle: payload,
      requiredSkills: [payload],
      notes: { ['a'.repeat(64)]: payload },
      results: [
        result({
          resume: {
            ...result().resume,
            name: payload,
            email: `candidate@example.com${payload}`
          },
          matchedSkills: [payload],
          missingSkills: [payload],
          evidence: [{ section: 'experience', text: payload, similarity: 1 }]
        })
      ],
      generatedAt: new Date('2026-08-28T00:00:00Z')
    })

    expect(html).not.toContain(payload)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;window.pwned = true&lt;/script&gt;')
  })
})

describe('shortlist CSV', () => {
  it('preserves recruiter selection order, Arabic, multiline notes, and quoted cells', () => {
    const csv = shortlistCsv({
      jobTitle: 'مدير التدريب',
      results: [result({ resume: { ...result().resume, name: 'Candidate, "One"' } })],
      notes: { ['a'.repeat(64)]: 'Discussed availability\nCan start in October' }
    })
    expect(csv.startsWith('\ufeff')).toBe(true)
    expect(csv).toContain('"مدير التدريب","1","Candidate, ""One"""')
    expect(csv).toContain('"Discussed availability\nCan start in October"')
  })

  it('neutralizes spreadsheet formulas in candidate data and notes', () => {
    const csv = shortlistCsv({
      jobTitle: '=SUM(1,2)',
      results: [result({ resume: { ...result().resume, name: '@SUM(1)', phone: '+966501234567' } })],
      notes: { ['a'.repeat(64)]: '  =HYPERLINK("https://example.invalid")' }
    })
    expect(csv).toContain('"\'=SUM(1,2)"')
    expect(csv).toContain('"\'@SUM(1)"')
    expect(csv).toContain('"\'+966501234567"')
    expect(csv).toContain('"\'  =HYPERLINK(')
  })
})
