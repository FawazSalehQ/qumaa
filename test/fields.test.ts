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

  it('keeps bare year ranges following a job title or heading', () => {
    expect(yearsFromDateRanges('Engineer 2019–2023')).toBe(5)
    expect(yearsFromDateRanges('Engineer\n2019–2023')).toBe(5)
    expect(yearsFromDateRanges('Experience\n2019–2023')).toBe(5)
  })

  it('continues to recognise full month names and common abbreviations', () => {
    expect(yearsFromDateRanges('January 2019–December 2023')).toBe(5)
    expect(yearsFromDateRanges('Sept. 2019–September 2020')).toBe(1.1)
  })

  it('handles numeric month/year formats', () => {
    expect(yearsFromDateRanges('01/2019 - 12/2019')).toBe(1)
  })

  it('skips ranges whose month or numeric form carries an impossible year', () => {
    // A typo, OCR slip or Hijri year must not produce a span the library validator rejects.
    expect(yearsFromDateRanges('Jan 1800 - Dec 2020')).toBeNull()
    expect(yearsFromDateRanges('01/1442 - 12/2020')).toBeNull()
    expect(yearsFromDateRanges('Jan 2019 - Dec 9999')).toBeNull()
    expect(yearsFromDateRanges('Jan 1015 - Present\nJan 2019 - Dec 2020')).toBe(2)
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

  it('does not read job titles, places or abbreviations as degrees', () => {
    const level = (text: string) => extractFields(normalizeText(text), splitSections(normalizeText(text))).educationLevel
    expect(level('Jane Doe\nCertified Scrum Master\n\nEXPERIENCE\nAcme — Scrum Master\nJan 2019 - Dec 2023\nLed delivery.')).toBeNull()
    expect(level('Jane Doe\nScrum Master\n\nEDUCATION\nBSc Computer Science, 2014')).toBe('bachelors')
    expect(level('Jane Doe\nBoston, MA 02116\n\nEDUCATION\nBSc Computer Science, 2014')).toBe('bachelors')
    expect(level('Jane Doe\nSenior BA\n\nEXPERIENCE\nBusiness analyst at Acme, 2019 to 2023.')).toBeNull()
    expect(level('Jane Doe\n\nEDUCATION\nMA Economics, 2016')).toBe('masters')
    expect(level('Jane Doe\nMaster of Science in Physics, 2016\nBA (Hons) English, 2012')).toBe('masters')
    expect(level('Jane Doe\n\nEDUCATION\nHigh school diploma, 2010')).toBeNull()
  })

  it('never stores more experience than the library validator accepts', () => {
    const text = normalizeText('Jane Doe\n\nEXPERIENCE\nJan 1960 - Present\nJan 1950 - Dec 1959')
    const years = extractFields(text, splitSections(text)).yearsExperience
    expect(years === null || years <= 100).toBe(true)
  })

  it('counts experience only from the experience section', () => {
    // Graduation years in EDUCATION must not be read as employment.
    expect(fields.yearsExperience).toBe(5)
  })

  it('detects skills', () => {
    expect(fields.skills).toContain('python')
    expect(fields.skills).toContain('kubernetes')
  })

  it('rejects digit lines as names in every script', () => {
    const name = (text: string) => extractFields(normalizeText(text), splitSections(normalizeText(text))).name
    expect(name('فواز بن عبدالله بن محمد القحطاني\nجوال ٠٥٠١٢٣٤٥٦٧\nالرياض')).toBeNull()
    expect(name('٠٥٠ ١٢٣ ٤٥٦٧\nفواز القحطاني\nالرياض')).toBe('فواز القحطاني')
    expect(name('050 123 4567\nJane Doe\nRiyadh')).toBe('Jane Doe')
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

  it('does not infer Khobar from Arabic experience headings or other partial words', () => {
    for (const line of ['الخبرة العملية', '## الخبرة العملية', 'الخبرات المهنية', 'الخبراء', 'خبيرالخبر', 'عمانيات', 'الخبر_العملية']) {
      const text = `أحمد القحطاني\n${line}\nمهندس حفر منذ 2019.`
      expect(extractFields(text, splitSections(text)).location).toBeNull()
    }
  })

  it('retains real Khobar locations with whitespace and Arabic punctuation', () => {
    for (const line of ['الخبر', 'الخبر، السعودية', '(الخبر)', 'الخبر | ahmed@example.com']) {
      const text = `أحمد القحطاني\n${line}\nالخبرة العملية\nمهندس حفر.`
      expect(extractFields(text, splitSections(text)).location).toBe('الخبر')
    }
    const labelled = 'أحمد القحطاني\nالعنوان: الخبر، المملكة العربية السعودية\nالخبرة العملية'
    expect(extractFields(labelled, splitSections(labelled)).location).toBe('الخبر، المملكة العربية السعودية')
  })

  it('retains complete Arabic multiword place names', () => {
    for (const location of ['مكة المكرمة', 'المدينة المنورة', 'أبو ظبي', 'المملكة العربية السعودية']) {
      const text = `أحمد القحطاني\n${location}`
      expect(extractFields(text, splitSections(text)).location).toBe(location)
    }
  })

  it('excludes education date ranges after Arabic and Markdown employment headings', () => {
    for (const [experience, education] of [
      ['## Employment', '## Education and training'],
      ['## الخبرة العملية', '## التعليم والتدريب'],
      ['الخبرة المهنية', 'المؤهلات العلمية']
    ]) {
      const text = `Candidate\n${experience}\nEngineer\n2019–2023\n${education}\nEngineering degree\n2013–2016`
      expect(extractFields(text, splitSections(text)).yearsExperience).toBe(5)
    }
  })

  it('returns nulls rather than throwing on a sparse document', () => {
    const text = 'some text'
    const f = extractFields(text, splitSections(text))
    expect(f.name).toBeNull()
    expect(f.email).toBeNull()
    expect(f.yearsExperience).toBeNull()
  })
})
