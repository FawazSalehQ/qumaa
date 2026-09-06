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

  it('defaults to an English LTR document', () => {
    const html = shortlistHtml({
      jobTitle: 'Training Manager', requiredSkills: [], results: [],
      generatedAt: new Date('2026-08-28T00:00:00Z')
    })
    expect(html).toContain('<html lang="en" dir="ltr">')
    expect(html).toContain('No named skills were identified in this posting.')
    expect(html).toContain('28 August 2026')
  })

  it('localizes Arabic labels, numbers, and Gregorian dates while preserving bilingual candidate evidence', () => {
    const html = shortlistHtml({
      language: 'ar', jobTitle: 'مدير التدريب / Training Manager',
      requiredSkills: ['Training', 'التدريب'], curated: true,
      results: [result({
        resume: { ...result().resume, name: 'ليلى Hassan', phone: '+966501234567' },
        evidence: [{ section: 'experience', text: 'Led training programs. درّبت فرق العمل.', similarity: 0.9 }]
      })],
      notes: { ['a'.repeat(64)]: 'متاحة في أكتوبر / Available in October' },
      generatedAt: new Date('2026-08-28T00:00:00Z')
    })
    expect(html).toContain('<html lang="ar" dir="rtl">')
    expect(html).toContain('<h2 dir="auto">ليلى Hassan</h2>')
    expect(html).toContain('<bdi dir="ltr">candidate@example.com</bdi>')
    expect(html).toContain('<bdi dir="ltr">+966501234567</bdi>')
    expect(html).toContain('<div dir="auto">Led training programs. درّبت فرق العمل.</div>')
    expect(html).toContain('متاحة في أكتوبر / Available in October')
    expect(html).toContain('التشابه الدلالي')
    expect(html).toContain('الخبرة العملية')
    expect(html).toContain('بكالوريوس')
    expect(html).toContain('ملاحظات مسؤول التوظيف')
    expect(html).toContain('<span class="score">٩١</span>')
    expect(html).toContain('٢٠٢٦')
    expect(html).not.toContain('١٤٤٨')
    expect(html).not.toContain('Selected and ordered by the recruiter.')
    expect(html).not.toMatch(/margin-left:|padding-left:|border-left:|text-align: right;/)
  })

  it('keeps Arabic export content escaped inside bidirectional markup', () => {
    const payload = 'سيرة <img src=x onerror="alert(1)">'
    const html = shortlistHtml({
      language: 'ar', jobTitle: payload, requiredSkills: [payload],
      results: [result({ resume: { ...result().resume, name: payload, phone: payload },
        evidence: [{ section: 'experience', text: payload, similarity: 1 }] })],
      notes: { ['a'.repeat(64)]: payload }, generatedAt: new Date('2026-08-28T00:00:00Z')
    })
    expect(html).not.toContain('<img')
    expect(html).toContain('سيرة &lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
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

  it('exports Arabic headers and education with intact source data and sortable numeric cells', () => {
    const csv = shortlistCsv({
      jobTitle: 'مدير التدريب',
      results: [result({ resume: { ...result().resume, name: 'ليلى Hassan', phone: '+966501234567' } })],
      notes: { ['a'.repeat(64)]: '=HYPERLINK("https://example.invalid")' }
    }, 'ar')
    expect(csv.startsWith('\ufeff"المسمى الوظيفي","الترتيب في القائمة المختصرة"')).toBe(true)
    expect(csv).toContain('"الخبرة (بالسنوات)"')
    expect(csv).toContain('"درجة المطابقة"')
    expect(csv).toContain('"مدير التدريب","1","ليلى Hassan","candidate@example.com"')
    expect(csv).toContain('"7","بكالوريوس","91","Training"')
    expect(csv).toContain('"\'+966501234567"')
    expect(csv).toContain('"\'=HYPERLINK(')
    expect(csv).not.toContain('Shortlist order')
  })
})
