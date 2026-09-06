import { describe, expect, it } from 'vitest'
import { ipcSchemas, parseIpc } from '../src/main/ipc-validation.js'

const result = {
  resume: {
    id: 1,
    recordKey: 'a'.repeat(64),
    fileName: 'candidate.md',
    filePath: '/tmp/candidate.md',
    importedAt: 1,
    name: 'Candidate',
    email: null,
    phone: null,
    location: null,
    yearsExperience: 5,
    educationLevel: 'bachelors' as const,
    skills: ['TypeScript']
  },
  score: 0.8,
  breakdown: { semantic: 0.8, lexical: 0.5, skills: 1 },
  matchedSkills: ['TypeScript'],
  missingSkills: [],
  evidence: [{ section: 'experience' as const, text: 'Built products.', similarity: 0.8 }]
}

describe('IPC runtime validation', () => {
  it('accepts a bounded rerank request', () => {
    expect(
      parseIpc(
        ipcSchemas.rerankPreviewArgs,
        { sessionId: '00000000-0000-4000-8000-000000000001' },
        'rerank request'
      )
    ).toEqual({ sessionId: '00000000-0000-4000-8000-000000000001' })
  })

  it('rejects renderer-supplied rerank evidence', () => {
    expect(() =>
      parseIpc(
        ipcSchemas.rerankPreviewArgs,
        { jobDescription: 'Senior engineer', results: [{ ...result, score: 20 }] },
        'rerank request'
      )
    ).toThrow('Invalid rerank request at sessionId')
  })

  it('rejects oversized text without reflecting it in the error', () => {
    const secret = `PRIVATE-${'x'.repeat(100_000)}`
    let message = ''
    try {
      parseIpc(ipcSchemas.jobDescription, secret, 'job description')
    } catch (error) {
      message = String(error)
    }
    expect(message).toContain('Invalid job description')
    expect(message).not.toContain('PRIVATE-')
  })

  it('requires absolute filesystem paths', () => {
    expect(() => parseIpc(ipcSchemas.absolutePath, '../resume.pdf', 'path')).toThrow(
      'must be an absolute path'
    )
  })

  it('rejects control characters in a pasted resume label', () => {
    for (const label of ['Candidate\0hidden', 'Candidate\nSecond line', 'Candidate\u007f']) {
      expect(() =>
        parseIpc(ipcSchemas.ingestText, { text: 'Valid resume text', label }, 'pasted resume')
      ).toThrow('must not contain control characters')
    }
  })

  it('rejects duplicate or excessive destructive references', () => {
    const ref = { id: 1, recordKey: 'a'.repeat(64) }
    expect(() => parseIpc(ipcSchemas.resumeRefs, [ref, ref], 'resume references')).toThrow(
      'must not contain duplicates'
    )
    expect(() =>
      parseIpc(
        ipcSchemas.resumeRefs,
        Array.from({ length: 5_001 }, (_, i) => ({
          id: i + 1,
          recordKey: i.toString(16).padStart(64, '0')
        })),
        'resume references'
      )
    ).toThrow('Too big')
  })

  it('accepts only supported setting enums', () => {
    expect(parseIpc(ipcSchemas.theme, 'dark', 'theme')).toBe('dark')
    expect(() => parseIpc(ipcSchemas.theme, 'sepia', 'theme')).toThrow('Invalid theme')
    expect(() => parseIpc(ipcSchemas.enabled, 'true', 'enabled')).toThrow('Invalid enabled')
  })
})
