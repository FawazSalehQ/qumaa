import type { AssessmentStatus, CandidateProfile, CandidateReview, JobWorkspace, ReviewStatus } from '@shared/recruiting.js'
import { candidateWithProfile, profileForResume } from '@shared/recruiting.js'
import type { MatchResult } from '@shared/types.js'

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
  confirmed: 'Recruiter confirmed'
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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation could not be completed. Please try again.'
}
