/** Pure recruiter-workflow rules. Ranking weights and eligibility stay untouched. */
import type { CandidateProfile, CandidateReview, CriterionEvidence, JobCriterion, JobPosting } from '@shared/recruiting.js'
import type { Evidence, MatchResult, SectionKind } from '@shared/types.js'
import { scoreSemantics, type ScoredChunk } from '../search/scoring.js'
import { splitRequirementClauses, stripRequirementBullet } from '@shared/job-requirements.js'

export function postingText(posting: JobPosting, criteria: JobCriterion[] = []): string {
  const parts = [posting.position, posting.jobDescription, posting.requirements, posting.educationAndCertifications]
    .map((part) => part.trim()).filter(Boolean)
  const key = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
  const included = new Set(parts.flatMap((part) => part.split(/\r?\n/u)).flatMap((line) => {
    const cleaned = stripRequirementBullet(line)
    return [cleaned, ...splitRequirementClauses(cleaned)]
  }).map(key).filter(Boolean))
  for (const criterion of criteria) {
    const text = criterion.text.trim()
    const normalized = key(text)
    // Importing a scorecard line must not repeat its existing posting wording
    // and increase its weight in per-query averages. Edited/new wording stays
    // searchable. Deliberately preserve punctuation and negation.
    if (!normalized || included.has(normalized)) continue
    parts.push(text)
    included.add(normalized)
  }
  return parts.join('\n\n')
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

/** Reapply saved Claude order only while it describes the same leading CVs. */
export function applySavedRerank(
  results: MatchResult[],
  ranking?: Array<{ recordKey: string; reason?: string }>
): { results: MatchResult[]; reranked: boolean } {
  if (!ranking) return { results, reranked: false }
  const leading = new Map(results.slice(0, ranking.length).map((result) => [result.resume.recordKey, result]))
  if (leading.size !== ranking.length || new Set(ranking.map((entry) => entry.recordKey)).size !== ranking.length || ranking.some((entry) => !leading.has(entry.recordKey))) {
    return { results, reranked: false }
  }
  return {
    results: [...ranking.map((entry) => ({ ...leading.get(entry.recordKey)!, ...(entry.reason ? { llmReason: entry.reason } : {}) })), ...results.slice(ranking.length)],
    reranked: true
  }
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

/**
 * Retrieve each requirement's nearest passage using the same section weighting
 * as search. Similarity is not a support/qualification verdict: even the nearest
 * passage can contradict a requirement or describe someone else's work.
 */
export function suggestSemanticCriterionEvidence(criteria: JobCriterion[], passages: ScoredChunk[], vectors: Float32Array[]): CriterionEvidence[] {
  if (vectors.length !== criteria.length) throw new Error('Requirement evidence vectors do not match the requested criteria.')
  // A leading name/header is frequently its own unstructured chunk. It is not
  // useful requirement evidence even if the multilingual model places it near
  // a short query. Exclude only tiny leading `other` chunks, and only when the
  // CV also contains a substantive passage. Keep short credentials in named
  // education/skills sections. This does not alter ingest or candidate ranking.
  const wordCount = (text: string): number => text.trim().split(/\s+/u).filter(Boolean).length
  let start = 0
  if (passages.some((passage) => wordCount(passage.text) >= 8)) {
    while (start < passages.length && passages[start].section === 'other' && wordCount(passages[start].text) <= 3) start++
  }
  const evidencePassages = passages.slice(start)
  return criteria.map((criterion, index) => {
    const vector = vectors[index]
    if (!vector.length || [...vector].some((value) => !Number.isFinite(value)) || passages.some((passage) => passage.vector.length !== vector.length)) {
      throw new Error('Requirement evidence vectors are incompatible with the current index.')
    }
    const nearest = scoreSemantics([vector], evidencePassages).evidence[0]
    return {
      criterionId: criterion.id,
      method: 'semantic',
      reviewNeeded: true,
      passage: nearest ? { ...nearest, text: passageExcerpt(nearest.text, criterion.text, 1_200) } : null
    }
  })
}
