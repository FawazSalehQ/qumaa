import { describe, it, expect } from 'vitest'
import { splitSections, sectionText } from '../src/main/ingest/sections.js'

const RESUME = `Jane Doe
jane@example.com

SUMMARY
Backend engineer with a decade of distributed systems work.

WORK EXPERIENCE
Acme Corp — Senior Engineer
Jan 2019 - Present
Built payment services in Go.

EDUCATION
BSc Computer Science, 2014

TECHNICAL SKILLS
Go, Kubernetes, PostgreSQL`

describe('splitSections', () => {
  it('labels each region by its heading', () => {
    const kinds = splitSections(RESUME).map((s) => s.kind)
    expect(kinds).toEqual(['other', 'summary', 'experience', 'education', 'skills'])
  })

  it('puts the header block before any heading into `other`', () => {
    const first = splitSections(RESUME)[0]
    expect(first.kind).toBe('other')
    expect(first.text).toContain('Jane Doe')
  })

  it('scopes section text correctly', () => {
    expect(sectionText(splitSections(RESUME), 'experience')).toContain('Acme Corp')
    expect(sectionText(splitSections(RESUME), 'experience')).not.toContain('BSc')
  })

  it('does not mistake a sentence for a heading', () => {
    // The length cap is what prevents this: the line matches /experience/ but is prose.
    const text = 'I have five years of experience building distributed systems for banks.'
    expect(splitSections(text).map((s) => s.kind)).toEqual(['other'])
  })

  it('still returns something for a resume with no headings at all', () => {
    const sections = splitSections('Just some unstructured text about a person.')
    expect(sections).toHaveLength(1)
    expect(sections[0].kind).toBe('other')
  })

  it('recognises heading variants', () => {
    for (const heading of ['EXPERIENCE', 'Professional Experience', 'Employment History']) {
      const sections = splitSections(`${heading}\nDid things at a company.`)
      expect(sections.some((s) => s.kind === 'experience')).toBe(true)
    }
  })
})
