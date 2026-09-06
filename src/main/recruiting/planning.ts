/** Pure recruiter-workflow rules. Ranking weights and eligibility stay untouched. */
import type { CandidateProfile, CandidateReview, JobCriterion, JobPosting } from '@shared/recruiting.js'
import type { Evidence, MatchResult, SectionKind } from '@shared/types.js'

export function postingText(posting: JobPosting, criteria: JobCriterion[] = []): string {
  return [posting.position, posting.jobDescription, posting.requirements, posting.educationAndCertifications,
    ...criteria.map((criterion) => criterion.text)].map((part) => part.trim()).filter(Boolean).join('\n\n')
}

export function isShortlisted(status: CandidateReview['status']): boolean {
  return status === 'shortlisted' || status === 'contacted'
}

export function emptyProfile(recordKey: string): CandidateProfile {
  return {
    candidateKey: recordKey, recordKeys: [recordKey], name: null, email: null, phone: null,
    location: null, yearsExperience: null, educationLevel: null, skills: null,
    expectedSalary: '', noticePeriod: '', availability: '', preferredLocation: '', tags: [], note: '', updatedAt: 0
  }
}

function meaningful(value: unknown): boolean {
  return value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)
}

/** Merge only compatible recruiter edits; ambiguity must never silently erase work. */
export function mergeProfiles(primary: CandidateProfile, version: CandidateProfile): CandidateProfile {
  const merged = { ...primary, recordKeys: [...new Set([...primary.recordKeys, ...version.recordKeys])], updatedAt: Date.now() }
  const fields = ['name', 'email', 'phone', 'location', 'yearsExperience', 'educationLevel', 'skills', 'expectedSalary', 'noticePeriod', 'availability', 'preferredLocation', 'note'] as const
  for (const field of fields) {
    const left = primary[field]
    const right = version[field]
    // An empty skills override is an explicit correction; null means use the
    // CV extraction. Other empty fields are simply unspecified.
    const leftPresent = field === 'skills' ? left !== null : meaningful(left)
    const rightPresent = field === 'skills' ? right !== null : meaningful(right)
    if (leftPresent && rightPresent && JSON.stringify(left) !== JSON.stringify(right)) throw new Error(`These profiles have different ${field} values. Reconcile those edits before linking CVs.`)
    if (!leftPresent) Object.assign(merged, { [field]: right })
  }
  merged.tags = [...new Set([...primary.tags, ...version.tags])]
  if (merged.tags.length > 50) throw new Error('The combined profiles have more than 50 tags. Reduce their tags before linking.')
  return merged
}

export function mergeReviews(primary: CandidateReview, version: CandidateReview): CandidateReview {
  if (primary.status !== version.status && primary.status !== 'unreviewed' && version.status !== 'unreviewed') throw new Error('These CVs have different decisions for the same job. Reconcile their reviews before linking.')
  if (primary.note && version.note && primary.note !== version.note) throw new Error('These CVs have different notes for the same job. Reconcile their notes before linking.')
  const assessments = new Map(primary.assessments.map((assessment) => [assessment.criterionId, assessment]))
  for (const right of version.assessments) {
    const left = assessments.get(right.criterionId)
    if (!left) { assessments.set(right.criterionId, right); continue }
    if ((left.status !== right.status && left.status !== 'unreviewed' && right.status !== 'unreviewed') || (left.note && right.note && left.note !== right.note)) throw new Error('These CVs have different requirement assessments. Reconcile their scorecards before linking.')
    assessments.set(right.criterionId, { ...left, status: left.status === 'unreviewed' ? right.status : left.status, note: left.note || right.note })
  }
  return { ...primary, status: primary.status === 'unreviewed' ? version.status : primary.status, note: primary.note || version.note, assessments: [...assessments.values()], updatedAt: Date.now() }
}

/** Use the latest imported CV for an explicitly linked person, then rank people. */
export function deduplicateVersions(results: MatchResult[], profiles: CandidateProfile[]): MatchResult[] {
  const owners = new Map(profiles.flatMap((profile) => profile.recordKeys.map((key) => [key, profile.candidateKey] as const)))
  const selected = new Map<string, MatchResult>()
  for (const result of results) {
    const key = owners.get(result.resume.recordKey) ?? result.resume.recordKey
    const previous = selected.get(key)
    if (!previous || result.resume.importedAt > previous.resume.importedAt || (result.resume.importedAt === previous.resume.importedAt && result.resume.id > previous.resume.id)) selected.set(key, result)
  }
  return [...selected.values()].sort((a, b) => b.score - a.score || b.resume.importedAt - a.resume.importedAt || b.resume.id - a.resume.id)
}

const STOP_WORDS = new Set('a an and are as at be by for from in is it of on or our that the their this to we will with you your must required preferred experience experienced years year skills skill have has ability capable candidate candidates في من على الي الى عن ان مع او و العمل خبره خبرة سنوات سنه سنة مطلوب يجب'.split(' '))
function normalize(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي')
}
function tokens(value: string): string[] {
  return [...new Set((normalize(value).match(/[\p{L}\p{N}+#]+(?:\.[\p{L}\p{N}]+)*/gu) ?? []).filter((word) => word.length > 1 && !STOP_WORDS.has(word)))]
}
export interface EvidencePassage { section: SectionKind; text: string }

/** A bounded verbatim window with offsets measured in the original CV text. */
export function passageExcerpt(text: string, query: string, maxChars = 1_500): string {
  if (text.length <= maxChars) return text
  const wanted = new Set(tokens(query))
  const matches = text.matchAll(/[\p{L}\p{M}\p{N}+#]+(?:\.[\p{L}\p{M}\p{N}]+)*/gu)
  let offset = 0
  for (const match of matches) {
    if (wanted.has(normalize(match[0]))) {
      offset = Math.max(0, match.index - 200)
      break
    }
  }
  // Materialise the small string so V8 cannot retain a huge parent string via
  // a sliced-string backing store while many jobs are browsed.
  if (offset > 0 && /[\uDC00-\uDFFF]/.test(text[offset]) && /[\uD800-\uDBFF]/.test(text[offset - 1])) offset--
  let end = Math.min(text.length, offset + maxChars)
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--
  return Buffer.from(text.slice(offset, end)).toString('utf8')
}

/** A lexical suggestion from actual CV text; lack of overlap says nothing about eligibility. */
export function suggestCriterionEvidence(criteria: JobCriterion[], passages: EvidencePassage[]): Array<{ criterionId: string; passage: Evidence | null }> {
  const prepared = passages.map((passage) => ({ ...passage, tokens: new Set(tokens(passage.text)) }))
  return criteria.map((criterion) => {
    const words = tokens(criterion.text)
    let best: (typeof prepared)[number] | undefined
    let overlap = 0
    for (const passage of prepared) {
      const count = words.filter((word) => passage.tokens.has(word)).length
      if (count > overlap || (count > 0 && count === overlap && passage.section === 'experience' && best?.section !== 'experience')) {
        overlap = count
        best = passage
      }
    }
    if (!best || overlap === 0 || words.length === 0) return { criterionId: criterion.id, passage: null }
    // Bound repeated scorecard excerpts while retaining a verbatim window near
    // a matching term. This is a suggestion, never an automatic assessment.
    return { criterionId: criterion.id, passage: { section: best.section, text: passageExcerpt(best.text, criterion.text, 1_200), similarity: overlap / words.length } }
  })
}
