import type { AssessmentStatus, CandidateProfile, CandidateReview, JobStatus, JobWorkspace, ReviewStatus } from '@shared/recruiting.js'
import { candidateWithProfile, profileForResume } from '@shared/recruiting.js'
import type { MatchResult } from '@shared/types.js'
import { stripIpcError, type Language, type Translator } from '@shared/i18n.js'

export const JOB_STATUS_LABELS: Record<JobStatus, string> = { open: 'Open', 'on-hold': 'On hold', filled: 'Filled', archived: 'Archived' }

export const REVIEW_LABELS: Record<ReviewStatus, string> = {
  unreviewed: 'Unreviewed',
  maybe: 'Maybe',
  shortlisted: 'Shortlisted',
  contacted: 'Contacted',
  'not-proceeding': 'Not proceeding'
}

export const ASSESSMENT_LABELS: Record<AssessmentStatus, string> = {
  unreviewed: 'Unreviewed',
  'evidence-found': 'Evidence found',
  'needs-clarification': 'Needs clarification',
  'not-stated': 'Not stated',
  confirmed: 'Recruiter confirmed',
  contradicted: 'Contradictory evidence'
}

export function isShortlisted(review?: CandidateReview): boolean {
  return review?.status === 'shortlisted' || review?.status === 'contacted'
}

export function candidateName(match: MatchResult, profile?: CandidateProfile): string {
  return candidateWithProfile(match.resume, profile).name || match.resume.fileName
}

export function shortlistMatches(workspace: JobWorkspace): MatchResult[] {
  const { reviewsByRecord } = indexWorkspace(workspace)
  return (workspace.response?.results ?? [])
    .filter((match) => isShortlisted(reviewsByRecord.get(match.resume.recordKey)))
    .sort((a, b) => {
      const orderA = reviewsByRecord.get(a.resume.recordKey)?.order ?? 0
      const orderB = reviewsByRecord.get(b.resume.recordKey)?.order ?? 0
      return orderA - orderB || a.resume.recordKey.localeCompare(b.resume.recordKey)
    })
}

/** A library can contain thousands of CVs; avoid repeated full profile scans per row. */
export function indexWorkspace(workspace: JobWorkspace): {
  profilesByRecord: Map<string, CandidateProfile>
  reviewsByRecord: Map<string, CandidateReview>
} {
  const profilesByRecord = new Map<string, CandidateProfile>()
  const reviewsByCandidate = new Map(workspace.reviews.map((review) => [review.candidateKey, review]))
  const reviewsByRecord = new Map(reviewsByCandidate)
  for (const profile of workspace.profiles) {
    for (const key of profile.recordKeys) {
      profilesByRecord.set(key, profile)
      const review = reviewsByCandidate.get(profile.candidateKey)
      if (review) reviewsByRecord.set(key, review)
      else reviewsByRecord.delete(key)
    }
  }
  return { profilesByRecord, reviewsByRecord }
}

export function matchProfile(workspace: JobWorkspace, match: MatchResult): CandidateProfile | undefined {
  return profileForResume(workspace.profiles, match.resume.recordKey)
}

export function errorMessage(error: unknown, fallback = 'The operation could not be completed. Please try again.'): string {
  return error instanceof Error ? error.message : fallback
}

/** Isolate interpolated user data without changing its stored value. */
export function bidiValue(value: string, language: Language, direction: 'auto' | 'ltr' = 'auto'): string {
  return language === 'ar' ? `${direction === 'ltr' ? '\u2066' : '\u2068'}${value}\u2069` : value
}

/** IPC errors stay in source form until render so switching language also updates an open error. */
export function recruitingError(message: string, t: Translator, language: Language): string {
  const clean = stripIpcError(message)
  const conflict = /^These profiles have different (\w+) values\. Reconcile those edits before linking CVs\.$/.exec(clean)
  if (conflict) {
    const fields: Record<string, string> = {
      name: 'Name', email: 'Email', phone: 'Phone', location: 'Location', yearsExperience: 'Years of experience',
      educationLevel: 'Education', skills: 'Skills', expectedSalary: 'Expected salary', noticePeriod: 'Notice period',
      availability: 'Availability', preferredLocation: 'Preferred location', note: 'Screening notes'
    }
    return t('These profiles have different {field} values. Reconcile those edits before linking CVs.', {
      field: language === 'ar' ? t(fields[conflict[1]] ?? conflict[1]) : conflict[1]
    })
  }
  const limit = /^The library has reached its (\d+)-(job|review|profile|snapshot|company) storage limit\.$/.exec(clean)
  if (limit) {
    const kinds: Record<string, string> = { job: 'Job records', review: 'Review records', profile: 'Profile records', snapshot: 'Search snapshots', company: 'Company records' }
    return t('The library has reached its {limit}-{kind} storage limit.', {
      limit: language === 'ar' ? Number(limit[1]) : limit[1], kind: language === 'ar' ? t(kinds[limit[2]]) : limit[2]
    })
  }
  if (language === 'ar' && clean.startsWith('Invalid recruiting data')) return t('The recruiting data is invalid. Check your entries and try again.')
  return t(clean)
}
