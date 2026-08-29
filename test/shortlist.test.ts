import { describe, expect, it, vi } from 'vitest'
import type { MatchResult } from '../src/shared/types.js'

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))

import { shortlistHtml } from '../src/main/export/shortlist.js'

function result(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    resume: {
      id: 1,
      fileName: 'candidate.pdf',
      filePath: '/candidate.pdf',
      fileType: 'pdf',
      importedAt: 1,
      name: 'Candidate One',
      email: 'candidate@example.com',
      phone: null,
      location: 'Riyadh',
      yearsExperience: 7,
      educationLevel: 'bachelors',
      skills: ['Training'],
      likelyScanned: false
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
