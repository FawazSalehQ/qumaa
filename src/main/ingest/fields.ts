/**
 * Heuristic extraction of structured fields. These drive display and filtering
 * only. Ranking never depends on them, so a mis-parsed name cannot corrupt a
 * search result.
 */
import type { EducationLevel } from '@shared/types.js'
import { DATABASE_LIMITS } from '../db/limits.js'
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

// Try only the beginning of each maximal local-part token. Retrying each
// suffix of a long token with no @ is quadratic. The domain cannot cross @,
// so each token is scanned a bounded number of times, even for malformed mail.
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
// Deliberately permissive: international formats vary wildly. Requires 9+ digits
// so it does not swallow years, postcodes, or "24/7".
const PHONE_RE = /(?:\+\p{Nd}{1,3}[\s.-]?)?(?:\(\p{Nd}{1,4}\)[\s.-]?)?\p{Nd}[\p{Nd}\s.-]{7,}\p{Nd}/u

function firstMatch(text: string, re: RegExp, maxChars: number): string | null {
  const m = text.match(re)
  if (!m) return null
  const value = m[0].trim()
  return value.length <= maxChars ? value : null
}

function extractPhone(text: string): string | null {
  for (const line of text.split('\n').slice(0, 30)) {
    // Skip lines that are clearly date ranges rather than numbers.
    if (/\b(19|20)\d{2}\s*[-–—]\s*((19|20)\d{2}|present)/i.test(line)) continue
    const m = line.match(PHONE_RE)
    if (m) {
      const digits = m[0].match(/\p{Nd}/gu) ?? []
      const value = m[0].trim()
      if (
        digits.length >= 9 &&
        digits.length <= 15 &&
        value.length <= DATABASE_LIMITS.phoneChars
      ) {
        return value
      }
    }
  }
  return null
}

/* ---------- name ---------- */

const NOT_A_NAME =
  /(?:\b(resume|curriculum\s+vitae|cv|profile|summary|objective|contact|address|phone|email|linkedin|github|portfolio)\b|السيرة\s+الذاتية|ملخص|الملف\s+الشخصي|الهدف|بيانات\s+الاتصال|العنوان|الهاتف|الجوال|البريد\s+الإلكتروني|المهارات|الخبرات)/i

/** Titles and suffixes we strip before deciding if a line looks like a name. */
const NAME_AFFIX = /^(?:(?:mr|mrs|ms|miss|dr|prof|eng)\.?|السيد(?:ة)?|د\.?|دكتور(?:ة)?|م\.?|مهندس(?:ة)?)\s+/i

function looksLikeName(line: string): boolean {
  const t = line.trim().replace(NAME_AFFIX, '')
  if (!t || t.length > 60) return false
  if (/\p{Nd}|@|https?:|\|/u.test(t)) return false
  if (NOT_A_NAME.test(t)) return false

  const words = t.split(/\s+/)
  if (words.length < 2 || words.length > 4) return false

  // Every word title-case ("Fawaz Alqahtani") or the whole line upper-case
  // ("FAWAZ ALQAHTANI"). Both are overwhelmingly common resume headers.
  const allTitle = words.every((w) => /^[A-Z][a-zA-Z'’-]*$/.test(w))
  const allUpper = words.every((w) => /^[A-Z][A-Z'’-]*$/.test(w)) && t === t.toUpperCase()
  const allArabic = words.every((w) => /^[\p{Script=Arabic}\p{M}'’ـ-]+$/u.test(w))
  return allTitle || allUpper || allArabic
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
const PLACE_WORD_CHARACTER = /[a-zA-Z.'-]/
const PLACE_REGION = /(?:[A-Z]{2,}|[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/y

/** Find the original heuristic's earliest word start in one disjoint token. */
function placeWordStart(line: string, start: number, end: number): number | null {
  for (let index = start; index + 1 < end; index++) {
    if (/[A-Z]/.test(line[index]) && (index === 0 || !/\w/.test(line[index - 1]))) return index
  }
  return null
}

function wordBefore(line: string, end: number): number {
  let start = end
  while (start > 0 && PLACE_WORD_CHARACTER.test(line[start - 1])) start--
  return start
}

/** Scan comma-delimited candidates once, rather than retrying every A in A-A-A. */
function matchPlace(line: string): string | null {
  for (let comma = line.indexOf(','); comma !== -1; comma = line.indexOf(',', comma + 1)) {
    const lastWord = wordBefore(line, comma)
    let start = placeWordStart(line, lastWord, comma)
    // The original heuristic accepts one or two words before the comma. Its
    // second word must begin immediately after whitespace with a capital.
    if (comma - lastWord >= 2 && /[A-Z]/.test(line[lastWord])) {
      let separator = lastWord
      while (separator > 0 && /\s/.test(line[separator - 1])) separator--
      if (separator < lastWord) {
        start = placeWordStart(line, wordBefore(line, separator), separator) ?? start
      }
    }
    if (start === null) continue
    let regionStart = comma + 1
    while (regionStart < line.length && /\s/.test(line[regionStart])) regionStart++
    PLACE_REGION.lastIndex = regionStart
    if (PLACE_REGION.test(line)) return line.slice(start, PLACE_REGION.lastIndex)
  }
  return null
}
const ARABIC_LOCATION_LABEL =
  /(?<![\p{L}\p{M}\p{N}_])(?:العنوان|الموقع|مكان\s+الإقامة|المدينة(?!\s+المنورة(?:[^\p{L}\p{M}\p{N}_]|$))|الدولة)(?![\p{L}\p{M}\p{N}_])\s*[:：-]?\s*([\p{Script=Arabic}\p{M}][\p{Script=Arabic}\p{M}\s،,-]{1,80})/u
// JavaScript's \b is ASCII-based: it cannot distinguish الخبر from الخبرة.
// Require complete Unicode tokens and prefer complete multiword place names.
const ARABIC_PLACE =
  /(?<![\p{L}\p{M}\p{N}_])(?:الرياض|جدة|مكة\s+المكرمة|مكة|المدينة\s+المنورة|الدمام|الخبر|الظهران|أبها|تبوك|دبي|أبو\s+ظبي|الدوحة|الكويت|مسقط|المنامة|المملكة\s+العربية\s+السعودية|السعودية|الإمارات|قطر|عمان|البحرين)(?![\p{L}\p{M}\p{N}_])/u

/**
 * "Charge Nurse, ICU" and "Distributed Computing, Imperial College" both match
 * the Title, Title shape of a place name. Rejecting job titles, employers and
 * institutions removes the bulk of those false positives.
 */
const NOT_A_PLACE =
  /\b(nurse|engineer|manager|director|analyst|developer|consultant|officer|assistant|specialist|accountant|intern|lead|head|president|hospital|university|college|school|institute|clinic|corp|corporation|inc|ltd|llc|gmbh|plc|company|department|unit|team|science|engineering|computing|studies|degree|bsc|msc|mba|phd)\b/i

function candidateLocation(line: string): string | null {
  const arabicLabelled = line.match(ARABIC_LOCATION_LABEL)
  if (arabicLabelled) {
    const value = arabicLabelled[1].trim().split(/\s{2,}|[|•]/u)[0]
    if (value) return value
  }
  const value = matchPlace(line)
  if (!value) return null
  return NOT_A_PLACE.test(value) || value.length > DATABASE_LIMITS.labelChars ? null : value
}

function extractLocation(text: string): string | null {
  // A line explicitly labelled as an address is the most trustworthy source.
  for (const line of text.split('\n').slice(0, 15)) {
    if (!/address|location|العنوان|الموقع|مكان\s+الإقامة|المدينة|الدولة/i.test(line)) continue
    const found = candidateLocation(line)
    if (found) return found
  }
  // Otherwise scan the header block, where a bare place name usually sits.
  for (const line of text.split('\n').slice(0, 8)) {
    const found = candidateLocation(line)
    if (found) return found
    const arabic = line.match(ARABIC_PLACE)
    if (arabic) return arabic[0]
  }
  return null
}

/* ---------- education ---------- */

// Inside a recognised education section short tokens such as MA or BA are degrees.
const EDUCATION_PATTERNS: Array<[EducationLevel, RegExp]> = [
  ['phd', /\b(ph\.?d|doctorate|doctoral|d\.phil)\b/i],
  ['masters', /\b(master'?s?|m\.?sc|m\.?a\b|m\.?b\.?a|m\.?eng|msc|mba)\b/i],
  ['bachelors', /\b(bachelor'?s?|b\.?sc|b\.?a\b|b\.?eng|bsc|undergraduate degree)\b/i],
  ['associate', /\b(associate'?s?\s+degree|a\.?a\.?s|(?<!high school )diploma)\b/i]
]
// Elsewhere a bare "Master" is a job title (Scrum Master), "MA" a US state and
// "BA" a business analyst, so the whole-document fallback demands degree context.
const STRICT_EDUCATION_PATTERNS: Array<[EducationLevel, RegExp]> = [
  ['phd', /\b(ph\.?d|doctorate|doctoral|d\.phil)\b/i],
  ['masters', /\b(master(?:'s|s)?\s+(?:of|in|degree)\b|m\.?sc\b|m\.a\.|ma\s+(?:in\b|\(hons\))|m\.?b\.?a\b|m\.?eng\b)/i],
  ['bachelors', /\b(bachelor(?:'s|s)?\b|b\.?sc\b|b\.a\.|ba\s+(?:in\b|\(hons\))|b\.?eng\b|undergraduate degree)/i],
  ['associate', /\b(associate'?s?\s+degree|a\.?a\.?s|(?<!high school )diploma)\b/i]
]

function matchEducation(text: string, patterns: Array<[EducationLevel, RegExp]>): EducationLevel | null {
  for (const [level, re] of patterns) {
    if (re.test(text)) return level // ordered highest-first
  }
  return null
}

function extractEducation(fullText: string, sections: Section[]): EducationLevel | null {
  const education = sectionText(sections, 'education')
  return (education ? matchEducation(education, EDUCATION_PATTERNS) : null) ?? matchEducation(fullText, STRICT_EDUCATION_PATTERNS)
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
    if (mon !== undefined && plausibleYear(Number(m[2]))) return monthIndex(Number(m[2]), mon)
  }
  m = s.match(/^(\d{1,2})\s*[/.-]\s*(\d{4})$/)
  if (m) {
    const mon = Number(m[1]) - 1
    if (mon >= 0 && mon <= 11 && plausibleYear(Number(m[2]))) return monthIndex(Number(m[2]), mon)
  }
  m = s.match(/^(\d{4})$/)
  if (m) {
    const y = Number(m[1])
    if (plausibleYear(y)) {
      // A bare year as a start means January; as an end, December.
      return monthIndex(y, isEnd ? 11 : 0)
    }
  }
  return null
}

// A typo, OCR slip or Hijri year in any date form must skip that range, not
// produce a span the startup validator rejects and the library cannot open with.
function plausibleYear(year: number): boolean {
  return year >= 1950 && year <= new Date().getFullYear() + 1
}

// A generic word before a year ("Engineer 2019") must not consume that year as
// an invalid month endpoint and hide the otherwise valid 2019–2023 range.
const MONTH_TOKEN = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DATE_ENDPOINT = `(?:\\b${MONTH_TOKEN}\\.?\\s+\\d{4}|\\d{1,2}\\s*[/.-]\\s*\\d{4}|\\d{4})`
const RANGE_RE = new RegExp(
  `(${DATE_ENDPOINT})\\s*(?:[-–—]|\\bto\\b|\\buntil\\b)\\s*(${DATE_ENDPOINT}|present|current|now|ongoing|to date)`,
  'gi'
)

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
  const parsedYears = yearsFromDateRanges(experience || fullText)
  const years = parsedYears !== null && parsedYears <= DATABASE_LIMITS.yearsExperience ? parsedYears : null

  return {
    name: extractName(fullText),
    email: firstMatch(fullText, EMAIL_RE, DATABASE_LIMITS.emailChars),
    phone: extractPhone(fullText),
    location: extractLocation(fullText),
    yearsExperience: years,
    educationLevel: extractEducation(fullText, sections),
    skills: extractSkills(fullText)
  }
}
