import { describe, expect, it } from 'vitest'
import { ipcSchemas, parseIpc } from '../src/main/ipc-validation.js'
import { recruitingSchemas } from '../src/main/recruiting/schema.js'

const jobId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000002'

describe('IPC runtime validation', () => {
  it('accepts a bounded rerank request', () => {
    expect(
      parseIpc(
        recruitingSchemas.rerankPreview,
        { jobId, sessionId },
        'rerank request'
      )
    ).toEqual({ jobId, sessionId })
  })

  it('rejects renderer-supplied rerank evidence', () => {
    expect(() =>
      parseIpc(
        recruitingSchemas.rerankPreview,
        { jobId, sessionId, results: [{ score: 20 }] },
        'rerank request'
      )
    ).toThrow('Invalid rerank request: Unrecognized key: "results"')
  })

  it('rejects oversized text without reflecting it in the error', () => {
    const secret = `PRIVATE-${'x'.repeat(500_000)}`
    let message = ''
    try {
      parseIpc(ipcSchemas.ingestText, { text: secret, label: 'Candidate' }, 'pasted resume')
    } catch (error) {
      message = String(error)
    }
    expect(message).toContain('Invalid pasted resume')
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
