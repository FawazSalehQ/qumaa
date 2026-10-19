import type { ClaudeRerankReview, EducationLevel, Evidence, MatchResult, ResumeRef, ResumeSummary, SearchResponse } from './types.js'

export interface JobPosting {
  position: string
  jobDescription: string
  requirements: string
  educationAndCertifications: string
}

export type JobStatus = 'open' | 'on-hold' | 'filled' | 'archived'

/** Per-field bound for company industries, locations and contact details. */
export const COMPANY_DETAIL_LIMIT = 50
export type CompanyDetailField = 'industry' | 'location' | 'contactName' | 'contactEmail'
export function normalizeCompanyDetailKey(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase()
}

export interface Company {
  id: string
  name: string
  industry: string[]
  location: string[]
  website: string
  contactName: string[]
  contactEmail: string[]
  note: string
  createdAt: number
  updatedAt: number
}

/** Legacy callers can supply one string; reads always return arrays. */
export type SaveCompanyInput = Omit<Company, 'id' | 'createdAt' | 'updatedAt' | CompanyDetailField>
  & Record<CompanyDetailField, string | string[]> & { id?: string }

export interface JobBudget {
  min: number
  max: number
  currency: string
  period: 'monthly' | 'annual' | 'hourly'
}

/** Total allocation for filling the vacancy, independent of recurring salary. */
export interface JobHiringBudget {
  min: number
  max: number
  currency: string
}

export interface JobTargetCompany {
  companyId: string
  status: 'to-research' | 'researching' | 'mapped' | 'excluded'
  focusRoles: string
  note: string
}

export interface SaveTargetCompaniesInput {
  jobId: string
  expectedUpdatedAt: number
  companies: JobTargetCompany[]
}

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
export type AssessmentStatus = 'unreviewed' | 'evidence-found' | 'needs-clarification' | 'not-stated' | 'confirmed' | 'contradicted'

export interface JobCriterion {
  id: string
  text: string
  importance: 'required' | 'preferred' | 'unspecified'
  /** Original vacancy wording retained when the recruiter edits the criterion. */
  source?: { field: 'jobDescription' | 'requirements' | 'educationAndCertifications'; text: string }
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
  companyId?: string | null
  budget?: JobBudget | null
  hiringBudget?: JobHiringBudget | null
  targetCompanies?: JobTargetCompany[]
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
  /** Retrieval locates a passage; it never confirms a qualification. */
  method?: 'semantic'
  reviewNeeded?: true
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
  companyId?: string | null
  budget?: JobBudget | null
  hiringBudget?: JobHiringBudget | null
  targetCompanies?: JobTargetCompany[]
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
  listCompanies(): Promise<Company[]>
  saveCompany(input: SaveCompanyInput): Promise<Company>
  saveTargetCompanies(input: SaveTargetCompaniesInput): Promise<JobWorkspace>
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
