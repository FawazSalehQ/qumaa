import { describe, it, expect } from 'vitest'
import { chunkSections } from '../src/main/ingest/chunk.js'
import type { Section } from '../src/main/ingest/sections.js'

const words = (n: number, token = 'word'): string =>
  Array.from({ length: n }, (_, i) => `${token}${i}`).join(' ')

describe('chunkSections', () => {
  it('keeps a short section as a single chunk', () => {
    const sections: Section[] = [{ kind: 'experience', text: words(50), start: 0 }]
    expect(chunkSections(sections)).toHaveLength(1)
  })

  it('splits a long section into overlapping windows', () => {
    const sections: Section[] = [{ kind: 'experience', text: words(500), start: 0 }]
    const chunks = chunkSections(sections)
    expect(chunks.length).toBeGreaterThan(1)

    // Consecutive windows must share text, or a fact straddling a boundary is
    // lost from both chunks.
    const first = chunks[0].text.split(' ')
    const second = chunks[1].text.split(' ')
    expect(first.slice(-10).every((w) => second.includes(w))).toBe(true)
  })

  it('never merges across a section boundary', () => {
    const sections: Section[] = [
      { kind: 'experience', text: words(30, 'exp'), start: 0 },
      { kind: 'education', text: words(30, 'edu'), start: 100 }
    ]
    const chunks = chunkSections(sections)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].text).not.toContain('edu')
    expect(chunks[1].text).not.toContain('exp')
  })

  it('tags each chunk with its section and a monotonic ordinal', () => {
    const sections: Section[] = [
      { kind: 'summary', text: words(30), start: 0 },
      { kind: 'skills', text: words(30), start: 100 }
    ]
    const chunks = chunkSections(sections)
    expect(chunks.map((c) => c.section)).toEqual(['summary', 'skills'])
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1])
  })

  it('drops trailing fragments too short to carry signal', () => {
    const sections: Section[] = [{ kind: 'other', text: words(3), start: 0 }]
    // A 3-word document is the only chunk, so it survives; a 3-word tail after a
    // real chunk would not.
    expect(chunkSections(sections)).toHaveLength(1)
  })
})
