import { describe, it, expect } from 'vitest'
import { extractFields, yearsFromDateRanges } from '../src/main/ingest/fields.js'
import { splitSections } from '../src/main/ingest/sections.js'
import { normalizeText } from '../src/main/ingest/normalize.js'

describe('yearsFromDateRanges', () => {
  it('sums a single range inclusively', () => {
    // Jan 2019 through Dec 2020 is 24 months of work.
    expect(yearsFromDateRanges('Jan 2019 - Dec 2020')).toBe(2)
  })

  it('adds separate, non-overlapping roles', () => {
    expect(yearsFromDateRanges('Jan 2015 - Dec 2016\nJan 2019 - Dec 2020')).toBe(4)
  })

  it('does not double-count concurrent roles', () => {
    // Two overlapping jobs across the same two years is still two years of
    // experience, not four. This is the whole reason intervals are merged.
    expect(yearsFromDateRanges('Jan 2019 - Dec 2020\nJun 2019 - Dec 2020')).toBe(2)
  })

  it('merges partially overlapping ranges', () => {
    expect(yearsFromDateRanges('Jan 2018 - Dec 2019\nJan 2019 - Dec 2020')).toBe(3)
  })

  it('handles bare years', () => {
    expect(yearsFromDateRanges('2019 - 2020')).toBe(2)
  })

  it('handles numeric month/year formats', () => {
    expect(yearsFromDateRanges('01/2019 - 12/2019')).toBe(1)
  })

  it('treats Present as today', () => {
    const thisYear = new Date().getFullYear()
    const years = yearsFromDateRanges(`Jan ${thisYear - 3} - Present`)
    expect(years).toBeGreaterThanOrEqual(3)
    expect(years).toBeLessThanOrEqual(4.1)
  })

  it('accepts en-dashes and the word "to"', () => {
    expect(yearsFromDateRanges('Jan 2019 – Dec 2020')).toBe(2)
    expect(yearsFromDateRanges('Jan 2019 to Dec 2020')).toBe(2)
  })

  it('ignores reversed ranges rather than producing negative time', () => {
    expect(yearsFromDateRanges('Dec 2020 - Jan 2019')).toBeNull()
  })

  it('returns null when there are no dates', () => {
    expect(yearsFromDateRanges('No dates here at all.')).toBeNull()
  })
})

const RESUME = normalizeText(`Jane Doe
Riyadh, Saudi Arabia
jane.doe@example.com | +966 50 123 4567

SUMMARY
Backend engineer.

WORK EXPERIENCE
Acme Corp — Senior Engineer
Jan 2019 - Dec 2023
Built payment services in Python and Kubernetes.

EDUCATION
MSc Computer Science, 2016
BSc Software Engineering, 2014`)

describe('extractFields', () => {
  const fields = extractFields(RESUME, splitSections(RESUME))

  it('finds the name from the header block', () => {
    expect(fields.name).toBe('Jane Doe')
  })

  it('finds the email', () => {
    expect(fields.email).toBe('jane.doe@example.com')
  })

  it('finds the phone number', () => {
    expect(fields.phone?.replace(/\D/g, '')).toContain('966501234567')
  })

  it('does not persist contact matches beyond stored-field limits', () => {
    const oversizedEmail = `${'a'.repeat(510)}@x.co`
    const oversizedPhone = Array.from({ length: 9 }, () => '1').join('.-'.repeat(20))
    const text = normalizeText(`Jane Doe\n${oversizedEmail}\n${oversizedPhone}`)
    const oversized = extractFields(text, splitSections(text))

    expect(oversized.email).toBeNull()
    expect(oversized.phone).toBeNull()
  })

  it('finds the location', () => {
    expect(fields.location).toBe('Riyadh, Saudi Arabia')
  })

  it('reports the highest degree, not the first one listed', () => {
    expect(fields.educationLevel).toBe('masters')
  })

  it('counts experience only from the experience section', () => {
    // Graduation years in EDUCATION must not be read as employment.
    expect(fields.yearsExperience).toBe(5)
  })

  it('detects skills', () => {
    expect(fields.skills).toContain('python')
    expect(fields.skills).toContain('kubernetes')
  })

  it('handles an all-caps name header', () => {
    const text = normalizeText('FAWAZ ALQAHTANI\nfawaz@example.com')
    expect(extractFields(text, splitSections(text)).name).toBe('FAWAZ ALQAHTANI')
  })

  it('does not mistake a document title for a name', () => {
    const text = normalizeText('Curriculum Vitae\nJohn Smith\njohn@example.com')
    expect(extractFields(text, splitSections(text)).name).toBe('John Smith')
  })

  it('rejects job titles that look like "Place, Region"', () => {
    // "Charge Nurse, ICU" matches the shape of a place name but is a role.
    const text = normalizeText('Elena Popescu\n\nEXPERIENCE\nRoyal Free Hospital\nCharge Nurse, ICU')
    expect(extractFields(text, splitSections(text)).location).toBeNull()
  })

  it('rejects institutions that look like "Place, Region"', () => {
    const text = normalizeText('Daniel Okafor\nMSc Distributed Computing, Imperial College')
    expect(extractFields(text, splitSections(text)).location).toBeNull()
  })

  it('still finds a genuine city, country pair', () => {
    const text = normalizeText('Jane Doe\nLondon, United Kingdom\njane@example.com')
    expect(extractFields(text, splitSections(text)).location).toBe('London, United Kingdom')
  })

  it('returns nulls rather than throwing on a sparse document', () => {
    const text = 'some text'
    const f = extractFields(text, splitSections(text))
    expect(f.name).toBeNull()
    expect(f.email).toBeNull()
    expect(f.yearsExperience).toBeNull()
  })
})
