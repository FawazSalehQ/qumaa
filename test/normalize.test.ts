import { describe, it, expect } from 'vitest'
import { normalizeText, flatten } from '../src/main/ingest/normalize.js'

describe('normalizeText', () => {
  it('expands ligatures that PDF extraction emits', () => {
    expect(normalizeText('oﬃce workﬂow staﬀ')).toBe('office workflow staff')
  })

  it('rejoins words hyphenated across a line break', () => {
    expect(normalizeText('engi-\nneering')).toBe('engineering')
  })

  it('leaves genuine hyphenated compounds alone', () => {
    expect(normalizeText('full-stack developer')).toBe('full-stack developer')
  })

  it('strips bullet glyphs but keeps the text', () => {
    expect(normalizeText('• Built an API\n• Led a team')).toBe('Built an API\nLed a team')
  })

  it('removes standalone page markers', () => {
    expect(normalizeText('Skills\nPage 2 of 5\nPython')).toBe('Skills\nPython')
    expect(normalizeText('Skills\n3\nPython')).toBe('Skills\nPython')
    expect(normalizeText('Skills\n12 of 40\nPython')).toBe('Skills\nPython')
  })

  it('keeps phone numbers and years that stand on their own line', () => {
    expect(normalizeText('Mobile\n0501234567\nRiyadh')).toBe('Mobile\n0501234567\nRiyadh')
    expect(normalizeText('Awards\n2015\nBest engineer')).toBe('Awards\n2015\nBest engineer')
  })

  it('preserves line structure, which the section splitter depends on', () => {
    expect(normalizeText('EXPERIENCE\nAcme Corp')).toContain('\n')
  })

  it('collapses excessive blank lines', () => {
    expect(normalizeText('a\n\n\n\n\nb')).toBe('a\n\nb')
  })

  it('normalises curly quotes', () => {
    expect(normalizeText('“quoted” and ’apostrophe’')).toBe(`"quoted" and 'apostrophe'`)
  })
})

describe('flatten', () => {
  it('produces a single line for hashing', () => {
    expect(flatten('  a\n\n b   c ')).toBe('a b c')
  })
})
