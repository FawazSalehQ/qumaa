import type { EducationLevel, Evidence, MatchResult, ResumeRef, ResumeSummary, SearchResponse } from './types.js'

export interface JobPosting {
  position: string
  jobDescription: string
  requirements: string
  educationAndCertifications: string
}

export type JobStatus = 'open' | 'on-hold' | 'filled' | 'archived'
export type ReviewStatus = 'unreviewed' | 'maybe' | 'shortlisted' | 'contacted' | 'not-proceeding'
export type AssessmentStatus = 'unreviewed' | 'evidence-found' | 'needs-clarification' | 'not-stated' | 'confirmed'

export interface JobCriterion {
  id: string
  text: string
  importance: 'required' | 'preferred'
}

export interface CriterionAssessment {
  criterionId: string
  status: AssessmentStatus
  note: string
}

export interface CandidateReview {
  jobId: string
  candidateKey: string
  status: ReviewStatus
  note: string
  order: number
  assessments: CriterionAssessment[]
  updatedAt: number
}

/** Recruiter-entered values stay separate from the immutable CV extraction. */
export interface CandidateProfile {
  candidateKey: string
  recordKeys: string[]
  name: string | null
  email: string | null
  phone: string | null
  location: string | null
  yearsExperience: number | null
  educationLevel: EducationLevel | null
  skills: string[] | null
  expectedSalary: string
  noticePeriod: string
  availability: string
  preferredLocation: string
  tags: string[]
  note: string
  updatedAt: number
}

export interface SavedJob {
  id: string
  posting: JobPosting
  status: JobStatus
  criteria: JobCriterion[]
  createdAt: number
  updatedAt: number
  lastSearchedAt: number | null
  candidateCount: number
  shortlistCount: number
  newResumeCount: number
  stale: boolean
}

export interface CriterionEvidence {
  criterionId: string
  passage: Evidence | null
}

export interface JobWorkspace {
  job: SavedJob
  response: SearchResponse | null
  reviews: CandidateReview[]
  profiles: CandidateProfile[]
  /** Keyed by resume content identity. Suggestions always require recruiter review. */
  evidence: Record<string, CriterionEvidence[]>
}

export interface SaveJobInput {
  id?: string
  posting: JobPosting
  status: JobStatus
  criteria: JobCriterion[]
}

export interface SaveReviewInput {
  jobId: string
  resume: ResumeRef
  status: ReviewStatus
  note: string
  order: number
  assessments: CriterionAssessment[]
}

export type SaveProfileInput = Omit<CandidateProfile, 'candidateKey' | 'recordKeys' | 'updatedAt'> & {
  resume: ResumeRef
}

export interface RecruitingApi {
  listJobs(): Promise<SavedJob[]>
  saveJob(input: SaveJobInput): Promise<SavedJob>
  getJob(id: string): Promise<JobWorkspace>
  searchJob(id: string): Promise<JobWorkspace>
  getEvidence(input: { jobId: string; resumes: ResumeRef[] }): Promise<Record<string, CriterionEvidence[]>>
  saveReview(input: SaveReviewInput): Promise<CandidateReview>
  reorderShortlist(input: { jobId: string; resumes: ResumeRef[] }): Promise<void>
  listProfiles(): Promise<CandidateProfile[]>
  saveProfile(input: SaveProfileInput): Promise<CandidateProfile>
  linkVersions(input: { primary: ResumeRef; version: ResumeRef }): Promise<CandidateProfile>
  unlinkVersion(input: { resume: ResumeRef }): Promise<void>
  exportShortlist(input: { jobId: string; format: 'pdf' | 'csv' }): Promise<string | null>
}

export function profileForResume(profiles: CandidateProfile[], recordKey: string): CandidateProfile | undefined {
  return profiles.find((profile) => profile.recordKeys.includes(recordKey))
}

export function candidateWithProfile(resume: ResumeSummary, profile?: CandidateProfile): ResumeSummary {
  if (!profile) return resume
  return {
    ...resume,
    name: profile.name ?? resume.name,
    email: profile.email ?? resume.email,
    phone: profile.phone ?? resume.phone,
    location: profile.location ?? resume.location,
    yearsExperience: profile.yearsExperience ?? resume.yearsExperience,
    educationLevel: profile.educationLevel ?? resume.educationLevel,
    skills: profile.skills ?? resume.skills
  }
}

export function reviewForMatch(reviews: CandidateReview[], profiles: CandidateProfile[], match: MatchResult): CandidateReview | undefined {
  const key = profileForResume(profiles, match.resume.recordKey)?.candidateKey ?? match.resume.recordKey
  return reviews.find((review) => review.candidateKey === key)
}
