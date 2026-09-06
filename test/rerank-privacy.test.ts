import { describe, expect, it } from 'vitest'
import type { MatchResult } from '../src/shared/types.js'
import {
  buildRerankPreview,
  CLAUDE_RERANK_CONSENT_VERSION,
  redactCandidateText,
  requestCandidateIndex
} from '../src/main/search/rerankPrivacy.js'

function candidate(overrides: Partial<MatchResult['resume']> = {}): MatchResult {
  return {
    resume: {
      id: 987654,
      recordKey: 'a'.repeat(64),
      fileName: 'Noura Al-Qahtani CV.pdf',
      filePath: '/Users/noura/private/Noura Al-Qahtani CV.pdf',
      importedAt: 123,
      name: 'Noura Al-Qahtani',
      email: 'noura@example.com',
      phone: '+966 50 123 4567',
      location: 'Riyadh, Saudi Arabia',
      yearsExperience: 8,
      educationLevel: 'bachelors',
      skills: ['TypeScript'],
      ...overrides
    },
    score: 0.92,
    breakdown: { semantic: 0.9, lexical: 0.8, skills: 1 },
    matchedSkills: ['TypeScript'],
    missingSkills: ['Kubernetes'],
    evidence: [
      {
        section: 'experience',
        similarity: 0.91,
        text: [
          'Noura Al-Qahtani — Riyadh, Saudi Arabia',
          'noura@example.com | +966 50 123 4567',
          'https://linkedin.com/in/noura and github.com/noura',
          '/Users/noura/private/resume.pdf C:\\Users\\noura\\resume.pdf',
          'Led a TypeScript platform migration from 2019 - 2024.'
        ].join('\n')
      }
    ]
  }
}

describe('Claude rerank privacy', () => {
  it('redacts known and patterned direct identifiers without removing year ranges', () => {
    const result = candidate()
    const text = redactCandidateText(result.evidence[0].text, result.resume)

    expect(text).not.toMatch(/Noura Al-Qahtani/i)
    expect(text).not.toContain('noura@example.com')
    expect(text).not.toContain('+966 50 123 4567')
    expect(text).not.toContain('Riyadh, Saudi Arabia')
    expect(text).not.toContain('linkedin.com/in/noura')
    expect(text).not.toContain('/Users/noura')
    expect(text).not.toContain('C:\\Users\\noura')
    expect(text).toContain('2019 - 2024')
    expect(text).toContain('[REDACTED NAME]')
    expect(text).toContain('[REDACTED EMAIL]')
    expect(text).toContain('[REDACTED PHONE]')
  })

  it('builds a serializable, consent-versioned preview with no identity mapping', () => {
    const preview = buildRerankPreview('Senior platform engineer', [candidate()])
    const serialized = JSON.stringify(preview)

    expect(preview.consentVersion).toBe(CLAUDE_RERANK_CONSENT_VERSION)
    expect(preview.provider).toBe('Anthropic')
    expect(preview.model).toBe('claude-sonnet-5')
    expect(preview.candidateCount).toBe(1)
    expect(preview.totalResultCount).toBe(1)
    expect(() => structuredClone(preview)).not.toThrow()
    expect(serialized).not.toContain('987654')
    expect(serialized).not.toContain('Noura Al-Qahtani')
    expect(serialized).not.toContain('noura@example.com')
    expect(serialized).not.toContain('+966 50 123 4567')
    expect(serialized).not.toContain('/Users/noura')
    expect(serialized).not.toContain('apiKey')
    expect(serialized).toContain('candidate-01')
    expect(serialized).toContain('[REDACTED NAME]')
  })

  it('redacts Arabic identifiers and strips an unstructured resume header', () => {
    const result = candidate({
      name: null,
      location: null,
      phone: null,
      fileName: 'سيرة-مرشح.pdf',
      filePath: '/Users/private/arabic.pdf'
    })
    result.evidence = [
      {
        section: 'other',
        similarity: 0.9,
        text:
          'أحمد محمد عبدالله العتيبي الرياض المملكة العربية السعودية الجوال ٠٥٥١٢٣٤٥٦٧ البريد ahmad@example.com مهندس نظم خبير قاد فرقاً تقنية كبيرة وطور منصات موثوقة وخدمات سحابية عالية الاعتمادية مع خبرة عميقة في إدارة المشاريع والتشغيل والتحسين المستمر',
      }
    ]

    const body = JSON.stringify(buildRerankPreview('مهندس نظم', [result]).requestBody)
    expect(body).not.toContain('أحمد محمد عبدالله العتيبي')
    expect(body).not.toContain('٠٥٥١٢٣٤٥٦٧')
    expect(body).not.toContain('ahmad@example.com')
    expect(body).toContain('[REDACTED NAME]')
  })

  it('recognises Arabic-Indic phone digits without swallowing Arabic year ranges', () => {
    const text = redactCandidateText(
      'الهاتف +٩٦٦ ٥٠ ١٢٣ ٤٥٦٧ والخبرة ٢٠١٩ - ٢٠٢٤',
      candidate({ phone: null }).resume
    )
    expect(text).toContain('[REDACTED PHONE]')
    expect(text).toContain('٢٠١٩ - ٢٠٢٤')
  })

  it('uses only strict request-local candidate ids', () => {
    expect(requestCandidateIndex('candidate-01')).toBe(0)
    expect(requestCandidateIndex('candidate-15')).toBe(14)
    expect(requestCandidateIndex('candidate-00')).toBeNull()
    expect(requestCandidateIndex('candidate-16')).toBeNull()
    expect(requestCandidateIndex('987654')).toBeNull()
    expect(requestCandidateIndex('candidate-1')).toBeNull()
  })

  it('limits outbound candidates to the rerank window without leaking later resumes', () => {
    const results = Array.from({ length: 17 }, (_, index) =>
      candidate({
        id: 50_000 + index,
        name: `Private Person ${index}`,
        email: `private${index}@example.com`,
        fileName: `Private Person ${index}.pdf`,
        filePath: `/Users/private/${index}.pdf`
      })
    )
    const preview = buildRerankPreview('Engineer', results)
    const body = JSON.stringify(preview.requestBody)

    expect(preview.candidateCount).toBe(15)
    expect(preview.totalResultCount).toBe(17)
    expect(body).toContain('candidate-15')
    expect(body).not.toContain('candidate-16')
    expect(body).not.toContain('private16@example.com')
  })
})
