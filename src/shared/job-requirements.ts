/** Offline vacancy-specific drafts. No profession or skills vocabulary is consulted. */
import type { JobCriterion, JobPosting } from './recruiting.js'

type Importance = JobCriterion['importance']
type SourceField = NonNullable<JobCriterion['source']>['field']
export type RequirementDraft = Omit<JobCriterion, 'id'>
const LIMIT = 40

/** Decimal quantities and signed values are content, not list markers. */
export function stripRequirementBullet(text: string): string {
  return text.replace(/^\s*(?:[-*]\s+|[•▪◦]\s*|[\d٠-٩]+[.)]\s+)/u, '').trim()
}

export function criterionImportanceLabel(importance: Importance): 'Required' | 'Preferred' | 'Unspecified' {
  return importance === 'required' ? 'Required' : importance === 'preferred' ? 'Preferred' : 'Unspecified'
}

function normalized(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim()
}

function explicitImportance(text: string): Importance | null {
  const value = normalized(text).replace(/’/gu, "'")
  // A negation can be separated from its obligation by several words, or can
  // negate just one part of a combined requirement. Do not infer its scope or
  // inherit a must-have heading in either case: leave this draft for review.
  // Hyphenated terms such as "no-dig" are terminology, not a negation cue.
  if (/\b(?:not|never|no|neither|without|cannot|can't|needn't|isn't|aren't|doesn't|don't)\b(?!-)/u.test(value)
    || /(?:^|\s)(?:لا|ليس|ليست|لن|لم|غير|دون|بدون)(?=\s|[،:؛.!؟]|$)/u.test(value)) return 'unspecified'
  const required = /\b(?:must(?:-have)?|required|mandatory|essential)\b/u.test(value)
    || /(?:^|\s)(?:يجب|يشترط|مطلوب[ةه]?|الزامي[ةه]?)(?=\s|[،:؛.!؟]|$)/u.test(value)
  const preferred = /\b(?:preferred|desirable|optional|nice[- ]to[- ]have)\b/u.test(value)
    || /(?:^|\s)(?:يفضل|مفضل[ةه]?|اختياري[ةه]?)(?=\s|[،:؛.!؟]|$)/u.test(value)
  if (required && preferred) return 'unspecified'
  return required ? 'required' : preferred ? 'preferred' : null
}

/**
 * Conservative sentence boundaries for editable requirement drafts. Preserve
 * credential abbreviations, examples and explicit alternatives as one clause;
 * splitting those would create qualifications the vacancy never requested.
 * Returned strings are verbatim substrings apart from surrounding whitespace.
 */
export function splitRequirementClauses(text: string): string[] {
  const clauses: string[] = []
  let start = 0
  for (const boundary of text.matchAll(/(?<=[.!?؟؛])\s+(?=[\p{L}\p{N}])/gu)) {
    const end = boundary.index
    const before = text.slice(start, end)
    const after = text.slice(end + boundary[0].length)
    const abbreviation = /(?:^|\s)(?:[\p{L}]{1,4}\.){2,}$/u.test(before)
      || /(?:^|\s)(?:BSc|MSc|PhD|Dr|Prof|Mr|Ms|Mrs|vs|etc|approx|د|م)\.$/iu.test(before)
    const alternative = /^(?:or\b|and\/or\b|أو(?=\s)|او(?=\s))/iu.test(after)
    if (abbreviation || alternative) continue
    const clause = before.trim()
    if (clause) clauses.push(clause)
    start = end + boundary[0].length
  }
  const remainder = text.slice(start).trim()
  if (remainder) clauses.push(remainder)
  return clauses
}

function heading(text: string): Importance | null {
  const value = normalized(text).replace(/^#+\s*|[*_]+|[:：]$/gu, '').trim()
  if (/^(?:must[- ]haves?|required(?: qualifications| requirements| skills)?|minimum requirements|mandatory qualifications|essential(?: qualifications| requirements| skills)?|متطلبات الزاميه|متطلبات الزامية|المتطلبات الالزامية|الموهلات المطلوبة)$/u.test(value)) return 'required'
  if (/^(?:preferred(?: qualifications| requirements| skills)?|desirable(?: qualifications| skills)?|nice[- ]to[- ]haves?|optional(?: qualifications| requirements| skills)?|يفضل|الموهلات المفضلة|المتطلبات المفضلة|مهارات مفضلة)$/u.test(value)) return 'preferred'
  if (/^(?:requirements|qualifications|skills|education(?: and certifications)?|certifications|responsibilities|duties|about(?: us| the role)?|job description|benefits|المتطلبات|الموهلات|المهارات|المسووليات|المهام|الوصف الوظيفي|التعليم والشهادات|المزايا)$/u.test(value)) return 'unspecified'
  return null
}

/**
 * Split actual vacancy wording into editable drafts. Unknown importance remains
 * unspecified; even explicit wording is a suggestion for recruiter review.
 * Original source text survives bullet cleanup and later recruiter corrections.
 */
export function extractJobRequirements(posting: JobPosting): { requirements: RequirementDraft[]; omitted: number } {
  const requirements: RequirementDraft[] = []
  const seen = new Set<string>()
  let omitted = 0
  // Dedicated fields have priority when a very large posting exceeds the cap.
  for (const field of ['requirements', 'educationAndCertifications', 'jobDescription'] as SourceField[]) {
    let context: Importance = 'unspecified'
    let skipSection = false
    for (const original of posting[field].split(/\r?\n/u)) {
      const line = original.trim()
      if (!line) continue
      const cleaned = stripRequirementBullet(line)
      const title = normalized(cleaned).replace(/^#+\s*|[*_]+|[:：]$/gu, '').trim()
      if (/^(?:benefits|perks|compensation|salary|about(?: us| the company)?|company overview|how to apply|المزايا|المزايا الوظيفية|الراتب|الرواتب|عن الشركة|نبذة عن الشركة|طريقة التقديم)$/u.test(title)) {
        skipSection = true
        continue
      }
      const section = heading(cleaned)
      if (section !== null) { context = section; skipSection = false; continue }
      if (skipSection) continue
      // Inline headings scope the following clauses just like standalone
      // headings. Keep their wording in the editable text and provenance.
      const sentences = splitRequirementClauses(cleaned)
      for (const sentence of sentences) {
        const text = sentence.trim()
        const inlineTitle = text.match(/^([^:：]{1,80})[:：]\s*\S/u)?.[1]
        const inlineSection = inlineTitle ? heading(inlineTitle) : null
        if (inlineSection !== null) context = inlineSection
        const explicit = explicitImportance(text)
        if (inlineSection !== null && explicit === 'unspecified') context = 'unspecified'
        const identity = normalized(text)
        if (!identity || seen.has(identity)) continue
        seen.add(identity)
        // Never truncate a qualification into a different requirement.
        if (text.length > 1_000 || line.length > 30_000 || requirements.length >= LIMIT) { omitted++; continue }
        // Siblings from one paragraph need distinct provenance so importing
        // again preserves an edited sibling without suppressing another one.
        requirements.push({ text, importance: explicit ?? context, source: { field, text: sentences.length === 1 ? line : sentence } })
      }
    }
  }
  return { requirements, omitted }
}
