import type { JobCriterion } from './recruiting.js'
import type { Language } from './i18n.js'

export interface ClientPackEvidence { id: string; section: string; text: string }
export interface ClientPackAnswer {
  id: string
  question: string
  answer: string
  verification: 'unverified' | 'candidate-stated' | 'recruiter-verified'
}

/** Deliberately excludes internal reviews, activities, CRM notes, and client feedback. */
export interface ClientPackCandidateSource {
  personId: string
  name: string
  email: string
  phone: string
  expectedSalary: string
  availability: string
  noticePeriod: string
  evidence: ClientPackEvidence[]
  answers: ClientPackAnswer[]
}

export interface ClientPackSource {
  jobId: string
  jobTitle: string
  criteria: Array<{ text: string; importance: JobCriterion['importance'] }>
  candidates: ClientPackCandidateSource[]
}

export interface ClientPackSelection {
  personId: string
  recommendation: string
  includeContact: boolean
  includeCompensation: boolean
  includeAvailability: boolean
  evidenceIds: string[]
  answerIds: string[]
}

export interface ClientPackConfig {
  jobId: string
  firmName: string
  introduction: string
  blind: boolean
  includeCriteria: boolean
  candidates: ClientPackSelection[]
}

/** This exact projection appears in the preview and is the only PDF input. */
export interface ClientPackDocument {
  language: Language
  generatedAt: number
  jobTitle: string
  firmName: string
  introduction: string
  blind: boolean
  criteria: ClientPackSource['criteria']
  candidates: Array<{
    label: string
    recommendation: string
    contact: Array<{ label: string; value: string }>
    details: Array<{ label: string; value: string }>
    evidence: Array<{ section: string; text: string }>
    answers: Array<Omit<ClientPackAnswer, 'id'>>
  }>
}

export interface ClientPackPreview { previewToken: string; document: ClientPackDocument }
export interface ClientPackApi {
  source(jobId: string, personIds?: string[]): Promise<ClientPackSource>
  preview(config: ClientPackConfig): Promise<ClientPackPreview>
  export(input: { config: ClientPackConfig; previewToken: string }): Promise<string | null>
}
