import type { ClaudeRerankReview, EducationLevel, Evidence, MatchResult, ResumeRef, ResumeSummary, SearchResponse } from './types.js'

export interface JobPosting {
  position: string
  jobDescription: string
  requirements: string
  educationAndCertifications: string
}

export type JobStatus = 'open' | 'on-hold' | 'filled' | 'archived'

/** Main-process snapshots of the people selected for a hiring decision. */
export interface JobPlacementCandidate {
  recordKey: string | null
  name: string | null
}

export interface JobPlacement {
  hired: JobPlacementCandidate
  backup2: JobPlacementCandidate | null
  backup3: JobPlacementCandidate | null
}

export interface JobStatusEvent {
  id: string
  status: JobStatus
  at: number
  kind: 'created' | 'status-changed' | 'placement-updated'
  placement?: JobPlacement
}

export interface ChangeJobStatusInput {
  jobId: string
  expectedUpdatedAt: number
  status: JobStatus
  placement?: { hired: ResumeRef; backup2?: ResumeRef; backup3?: ResumeRef }
}
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
  /** Older jobs may lack history; do not infer unrecorded transition dates. */
  statusHistory?: JobStatusEvent[]
  /** Most recent recorded hiring outcome, retained when archived or reopened. */
  placement?: JobPlacement
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
  /** True for the unsaved, process-local search in Jobs. */
  temporary?: boolean
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
  changeJobStatus(input: ChangeJobStatusInput): Promise<JobWorkspace>
  getJob(id: string): Promise<JobWorkspace>
  searchJob(id: string): Promise<JobWorkspace>
  searchTemporary(input: Omit<SaveJobInput, 'id'>): Promise<JobWorkspace>
  saveTemporary(input: { jobId: string; sessionId: string }): Promise<JobWorkspace>
  discardTemporary(jobId: string): Promise<void>
  exportTemporary(input: { jobId: string; sessionId: string }): Promise<string | null>
  previewRerank(input: { jobId: string; sessionId: string }): Promise<ClaudeRerankReview>
  rerank(input: { jobId: string; sessionId: string; approvalToken: string }): Promise<JobWorkspace>
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
