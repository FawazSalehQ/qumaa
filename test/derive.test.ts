import { describe, expect, it } from 'vitest'
import { deriveResumeText, deriveStoredResumeText, normalizeResumeText, resumeContentHash } from '../src/main/ingest/derive.js'

describe('canonical resume text', () => {
  it('rejects embedded NUL before the text can enter the library', () => {
    expect(() => normalizeResumeText('Candidate\0hidden tail')).toThrow(
      'unsupported NUL character'
    )
    expect(() => deriveStoredResumeText('Candidate\0hidden tail')).toThrow('unsupported NUL character')
  })

  it('derives stored text without changing it or its identity', () => {
    // Bulleted numbers survive one normalisation but not a second, so a rebuild
    // that re-normalised stored text would mis-hash this resume.
    const raw = 'Jane Doe\nRiyadh\n\nAWARDS\n• 2019\n• 2021\n\nEXPERIENCE\nAcme Corp — Senior Engineer\nJan 2019 - Dec 2023\nBuilt payment services in Python and Kubernetes for retail clients across the region.'
    const ingested = deriveResumeText(raw)
    const rebuilt = deriveStoredResumeText(ingested.normalized)
    expect(rebuilt.normalized).toBe(ingested.normalized)
    expect(rebuilt.contentHash).toBe(resumeContentHash(ingested.normalized))
    expect(rebuilt.chunks).toEqual(ingested.chunks)
    expect(rebuilt.fields).toEqual(ingested.fields)
  })
})
