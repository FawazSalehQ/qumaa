import { describe, expect, it } from 'vitest'
import { normalizeResumeText } from '../src/main/ingest/derive.js'

describe('canonical resume text', () => {
  it('rejects embedded NUL before the text can enter the library', () => {
    expect(() => normalizeResumeText('Candidate\0hidden tail')).toThrow(
      'unsupported NUL character'
    )
  })
})
