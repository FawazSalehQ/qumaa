/** Types shared across main, preload, and renderer. Keep this dependency-free. */

export type FileType = 'pdf' | 'docx' | 'txt' | 'md' | 'pasted'

export type SectionKind = 'summary' | 'experience' | 'education' | 'skills' | 'projects' | 'other'

export type EducationLevel = 'phd' | 'masters' | 'bachelors' | 'associate' | 'none'

/** A resume row as shown in the Library view (no raw text, no vectors). */
export interface ResumeSummary {
  id: number
  fileName: string
  filePath: string
  fileType: FileType
  importedAt: number
  name: string | null
  email: string | null
  phone: string | null
  location: string | null
  yearsExperience: number | null
  educationLevel: EducationLevel | null
  skills: string[]
  /** True when a PDF yielded almost no text, probably a scan needing OCR. */
  likelyScanned: boolean
}

/** One indexed passage of a resume, as stored. */
export interface ResumePassage {
  section: SectionKind
  ordinal: number
  text: string
}

/** Everything the detail panel shows for one resume. */
export interface ResumeDetail {
  summary: ResumeSummary
  rawText: string
  passages: ResumePassage[]
}

/** Outcome of attempting to ingest one file. */
export type IngestOutcome =
  | { status: 'imported'; resume: ResumeSummary }
  | { status: 'duplicate'; fileName: string; existingId: number }
  | { status: 'unsupported'; fileName: string; reason: string }
  | { status: 'failed'; fileName: string; reason: string }

export interface IngestProgress {
  /** Stable id so the renderer can correlate progress with a request. */
  jobId: string
  processed: number
  total: number
  currentFile: string
  done: boolean
}

/** One piece of resume text that supports a match. */
export interface Evidence {
  section: SectionKind
  text: string
  similarity: number
}

export interface MatchResult {
  resume: ResumeSummary
  /** Final blended score, 0..1. */
  score: number
  /** Component scores before weighting, each 0..1, for the breakdown UI. */
  breakdown: {
    semantic: number
    lexical: number
    skills: number
  }
  matchedSkills: string[]
  missingSkills: string[]
  evidence: Evidence[]
}

export interface SearchResponse {
  results: MatchResult[]
  /** Skills parsed out of the job description. */
  requiredSkills: string[]
  totalCandidates: number
  elapsedMs: number
}

export interface AppSettings {
  watchedFolder: string | null
}

export interface DbStats {
  resumeCount: number
  chunkCount: number
  dbPath: string
  dbSizeBytes: number
}

/** Commands the application menu sends to the renderer. */
export type MenuCommand =
  | 'new-search'
  | 'import-files'
  | 'import-folder'
  | 'goto-match'
  | 'goto-library'
  | 'goto-settings'

export type ModelStatus =
  | { state: 'loading' }
  | { state: 'ready'; dimensions: number }
  | { state: 'error'; message: string }
