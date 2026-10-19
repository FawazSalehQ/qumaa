import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { normalizeText } from '../src/main/ingest/normalize.js'
import { splitSections } from '../src/main/ingest/sections.js'
import { extractFields } from '../src/main/ingest/fields.js'
import { buildFtsQuery } from '../src/main/search/scoring.js'

// A generous budget for bounded input: the vulnerable expressions took seconds
// at this size. Keep these below the supported 500,000-character resume limit.
function withinBudget<T>(run: () => T): T {
  const start = performance.now()
  const result = run()
  expect(performance.now() - start).toBeLessThan(1_000)
  return result
}

describe('adversarial text parsing', () => {
  it.each(['\n', '\r\n', '\u2028', '\u2029'])('handles repeated %j line terminators without rescanning suffixes', (separator) => {
    const text = `Candidate${separator.repeat(100_000)}Experience\nBuilt useful systems.`
    expect(withinBudget(() => normalizeText(text))).toContain('Experience\nBuilt useful systems.')
  })

  it('retains indented and standalone bullets without consuming preceding paragraphs', () => {
    expect(normalizeText('Summary\n\n\u2003• Built an API\n•\nLed a team'))
      .toBe('Summary\n\nBuilt an API\nLed a team')
  })

  it.each(['-', ':', '—'])('does not retry a long non-heading punctuation suffix (%s)', (punctuation) => {
    const text = `${punctuation.repeat(100_000)}x`
    expect(withinBudget(() => splitSections(text))).toEqual([{ kind: 'other', text, start: 0 }])
  })

  it('does not retry Unicode whitespace when Markdown closing hashes are absent', () => {
    const text = `# Skills ${'\u2003'.repeat(100_000)}X`
    expect(withinBudget(() => splitSections(text))).toEqual([{ kind: 'other', text, start: 0 }])
    expect(splitSections('## Skills ###\nPython')[0].kind).toBe('skills')
    expect(splitSections('## Skills###\nPython')[0].kind).toBe('other')
  })

  it('bounds email scanning for long missing separators and malformed domain runs', () => {
    for (const text of ['a'.repeat(100_000), `a@${'.'.repeat(100_000)}x`, `${'a@'.repeat(50_000)}x`]) {
      expect(withinBudget(() => extractFields(text, []))).toHaveProperty('email', null)
    }
  })

  it('retains email matching semantics without salvaging an oversized token suffix', () => {
    expect(extractFields('prefix:a@bad@example.com; jane.doe+jobs@example.co.uk', []).email).toBe('bad@example.com')
    expect(extractFields('jane.doe+jobs@example.co.uk', []).email).toBe('jane.doe+jobs@example.co.uk')
    expect(extractFields(`${'a'.repeat(510)}@x.co`, []).email).toBeNull()
    expect(extractFields('bad@domain.7\nvalid@example.com', []).email).toBe('valid@example.com')
  })

  it('scans long hyphenated location tokens once without salvaging an oversized suffix', () => {
    expect(withinBudget(() => extractFields('A-'.repeat(50_000), []))).toHaveProperty('location', null)
    expect(withinBudget(() => extractFields(`${'A-'.repeat(50_000)}London, UK`, []))).toHaveProperty('location', null)
    for (const location of ['London, UK', 'New York, United States', '-London, UK', 'label-London, UK']) {
      expect(extractFields(location, []).location).toBe(location.replace(/^(?:-|label-)/, ''))
    }
  })

  it('preserves the prior location heuristic on bounded mixed punctuation', () => {
    const prior = /\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?),\s*([A-Z]{2,}|[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/
    const alphabet = 'AaBbx.-\'_, 1\t'
    let seed = 17
    for (let sample = 0; sample < 1_000; sample++) {
      let line = ''
      for (let i = 0; i < 60; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        line += alphabet[seed % alphabet.length]
      }
      expect(extractFields(line, []).location, line).toBe(line.match(prior)?.[0] ?? null)
    }
  })

  it('trims only trailing query periods in linear time', () => {
    const term = `a${'.'.repeat(90_000)}b`
    expect(withinBudget(() => buildFtsQuery(term))).toBe(`"${term}"`)
    expect(buildFtsQuery('Node.js...')).toBe('"node.js"')
  })
})
