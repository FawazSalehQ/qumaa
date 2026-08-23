/**
 * Heuristic extraction of structured fields. These drive display and filtering
 * only. Ranking never depends on them, so a mis-parsed name cannot corrupt a
 * search result.
 */
import type { EducationLevel } from '@shared/types.js'
import { extractSkills } from './skills.js'
import { sectionText, type Section } from './sections.js'

export interface ExtractedFields {
  name: string | null
  email: string | null
  phone: string | null
  location: string | null
  yearsExperience: number | null
  educationLevel: EducationLevel | null
  skills: string[]
}

/* ---------- contact ---------- */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
// Deliberately permissive: international formats vary wildly. Requires 9+ digits
// so it does not swallow years, postcodes, or "24/7".
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s.-]{7,}\d/

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re)
  return m ? m[0].trim() : null
}

function extractPhone(text: string): string | null {
  for (const line of text.split('\n').slice(0, 30)) {
    // Skip lines that are clearly date ranges rather than numbers.
    if (/\b(19|20)\d{2}\s*[-–—]\s*((19|20)\d{2}|present)/i.test(line)) continue
    const m = line.match(PHONE_RE)
    if (m) {
      const digits = m[0].replace(/\D/g, '')
      if (digits.length >= 9 && digits.length <= 15) return m[0].trim()
    }
  }
  return null
}

/* ---------- name ---------- */

const NOT_A_NAME =
  /\b(resume|curriculum\s+vitae|cv|profile|summary|objective|contact|address|phone|email|linkedin|github|portfolio)\b/i

/** Titles and suffixes we strip before deciding if a line looks like a name. */
const NAME_AFFIX = /^(mr|mrs|ms|miss|dr|prof|eng)\.?\s+/i

function looksLikeName(line: string): boolean {
  const t = line.trim().replace(NAME_AFFIX, '')
  if (!t || t.length > 60) return false
  if (/\d|@|https?:|\|/.test(t)) return false
  if (NOT_A_NAME.test(t)) return false

  const words = t.split(/\s+/)
  if (words.length < 2 || words.length > 4) return false

  // Every word title-case ("Fawaz Alqahtani") or the whole line upper-case
  // ("FAWAZ ALQAHTANI"). Both are overwhelmingly common resume headers.
  const allTitle = words.every((w) => /^[A-Z][a-zA-Z'’-]*$/.test(w))
  const allUpper = words.every((w) => /^[A-Z][A-Z'’-]*$/.test(w)) && t === t.toUpperCase()
  return allTitle || allUpper
}

function extractName(text: string): string | null {
  for (const line of text.split('\n').slice(0, 12)) {
    if (looksLikeName(line)) {
      return line
        .trim()
        .replace(NAME_AFFIX, '')
        .replace(/\s+/g, ' ')
    }
  }
  return null
}

/* ---------- location ---------- */

// "Riyadh, Saudi Arabia" / "London, UK" / "Austin, TX"
const LOCATION_RE = /\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?),\s*([A-Z]{2,}|[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/

/**
 * "Charge Nurse, ICU" and "Distributed Computing, Imperial College" both match
 * the Title, Title shape of a place name. Rejecting job titles, employers and
 * institutions removes the bulk of those false positives.
 */
const NOT_A_PLACE =
  /\b(nurse|engineer|manager|director|analyst|developer|consultant|officer|assistant|specialist|accountant|intern|lead|head|president|hospital|university|college|school|institute|clinic|corp|corporation|inc|ltd|llc|gmbh|plc|company|department|unit|team|science|engineering|computing|studies|degree|bsc|msc|mba|phd)\b/i

function candidateLocation(line: string): string | null {
  const m = line.match(LOCATION_RE)
  if (!m) return null
  return NOT_A_PLACE.test(m[0]) ? null : m[0].trim()
}

function extractLocation(text: string): string | null {
  // A line explicitly labelled as an address is the most trustworthy source.
  for (const line of text.split('\n').slice(0, 15)) {
    if (!/address|location/i.test(line)) continue
    const found = candidateLocation(line)
    if (found) return found
  }
  // Otherwise scan the header block, where a bare place name usually sits.
  for (const line of text.split('\n').slice(0, 8)) {
    const found = candidateLocation(line)
    if (found) return found
  }
  return null
}

/* ---------- education ---------- */

const EDUCATION_PATTERNS: Array<[EducationLevel, RegExp]> = [
  ['phd', /\b(ph\.?d|doctorate|doctoral|d\.phil)\b/i],
  ['masters', /\b(master'?s?|m\.?sc|m\.?a\b|m\.?b\.?a|m\.?eng|msc|mba)\b/i],
  ['bachelors', /\b(bachelor'?s?|b\.?sc|b\.?a\b|b\.?eng|bsc|undergraduate degree)\b/i],
  ['associate', /\b(associate'?s?\s+degree|a\.?a\.?s|diploma)\b/i]
]

function extractEducation(text: string): EducationLevel | null {
  for (const [level, re] of EDUCATION_PATTERNS) {
    if (re.test(text)) return level // ordered highest-first
  }
  return null
}

/* ---------- years of experience ---------- */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
}

interface Interval {
  start: number // months since year 0
  end: number
}

function monthIndex(year: number, month: number): number {
  return year * 12 + month
}

/** Parses "Jan 2019", "January 2019", "01/2019", "2019", "Present". */
function parseEndpoint(raw: string, isEnd: boolean): number | null {
  const s = raw.trim().toLowerCase()
  if (/^(present|current|now|ongoing|to date)$/.test(s)) {
    const now = new Date()
    return monthIndex(now.getFullYear(), now.getMonth())
  }
  let m = s.match(/^([a-z]{3,9})\.?\s+(\d{4})$/)
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3)]
    if (mon !== undefined) return monthIndex(Number(m[2]), mon)
  }
  m = s.match(/^(\d{1,2})\s*[/.-]\s*(\d{4})$/)
  if (m) {
    const mon = Number(m[1]) - 1
    if (mon >= 0 && mon <= 11) return monthIndex(Number(m[2]), mon)
  }
  m = s.match(/^(\d{4})$/)
  if (m) {
    const y = Number(m[1])
    if (y >= 1950 && y <= new Date().getFullYear() + 1) {
      // A bare year as a start means January; as an end, December.
      return monthIndex(y, isEnd ? 11 : 0)
    }
  }
  return null
}

const RANGE_RE =
  /([A-Za-z]{3,9}\.?\s+\d{4}|\d{1,2}\s*[/.-]\s*\d{4}|\d{4})\s*(?:[-–—]|\bto\b|\buntil\b)\s*([A-Za-z]{3,9}\.?\s+\d{4}|\d{1,2}\s*[/.-]\s*\d{4}|\d{4}|present|current|now|ongoing|to date)/gi

/** Merges overlapping employment periods so concurrent roles are not double-counted. */
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: Interval[] = [sorted[0]]
  for (const iv of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end)
    } else {
      merged.push({ ...iv })
    }
  }
  return merged
}

export function yearsFromDateRanges(text: string): number | null {
  const intervals: Interval[] = []
  RANGE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RANGE_RE.exec(text)) !== null) {
    const start = parseEndpoint(m[1], false)
    const end = parseEndpoint(m[2], true)
    if (start === null || end === null || end < start) continue
    // +1 because an inclusive Jan–Jan span is one month of work, not zero.
    intervals.push({ start, end: end + 1 })
  }
  if (intervals.length === 0) return null

  const months = mergeIntervals(intervals).reduce((sum, iv) => sum + (iv.end - iv.start), 0)
  return Math.round((months / 12) * 10) / 10
}

/* ---------- entry point ---------- */

export function extractFields(fullText: string, sections: Section[]): ExtractedFields {
  const experience = sectionText(sections, 'experience')
  // Prefer date ranges inside the experience section; fall back to the whole
  // document for resumes with no recognisable headings.
  const years = yearsFromDateRanges(experience || fullText)

  return {
    name: extractName(fullText),
    email: firstMatch(fullText, EMAIL_RE),
    phone: extractPhone(fullText),
    location: extractLocation(fullText),
    yearsExperience: years,
    educationLevel: extractEducation(fullText),
    skills: extractSkills(fullText)
  }
}
