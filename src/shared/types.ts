/** Types shared across main, preload, and renderer. Keep this dependency-free. */

export type SectionKind = 'summary' | 'experience' | 'education' | 'skills' | 'projects' | 'other'

export type EducationLevel = 'phd' | 'masters' | 'bachelors' | 'associate'

/** A resume row as shown in the Library view (no raw text, no vectors). */
export interface ResumeSummary {
  id: number
  /** Content-bound record identity used to reject stale numeric ids after restore. */
  recordKey: string
  fileName: string
  filePath: string
  importedAt: number
  name: string | null
  email: string | null
  phone: string | null
  location: string | null
  yearsExperience: number | null
  educationLevel: EducationLevel | null
  skills: string[]
}

export interface ResumeRef {
  id: number
  recordKey: string
}

/** Everything the detail panel shows for one resume. */
export interface ResumeDetail {
  rawText: string
  passageCount: number
}

/** Outcome of attempting to ingest one file. */
export type IngestOutcome =
  | { status: 'imported'; resume: ResumeSummary }
  | { status: 'duplicate'; fileName: string; existingId: number }
  /** Not byte-identical, but almost certainly the same candidate. Imported, and
   *  flagged so the user can decide. */
  | {
      status: 'near-duplicate'
      resume: ResumeSummary
      similarTo: { id: number; name: string | null; fileName: string; similarity: number }
    }
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
  /** One sentence from the optional Claude rerank, when it ran. */
  llmReason?: string
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
  /** True when the saved job has an applicable AI ordering. Local scores remain unchanged. */
  reranked?: boolean
  /** Provider/model that produced this saved ordering, independent of current Settings. */
  rerankConfig?: import('./rerank.js').RerankConfig
  /** Opaque handle to the immutable main-process result snapshot. */
  sessionId: string
  results: MatchResult[]
  /** Skills parsed out of the job description. */
  requiredSkills: string[]
  totalCandidates: number
  elapsedMs: number
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/** Renderer-safe description of the exact request body sent for optional reranking. */
export interface ClaudeRerankPreview {
  consentVersion: string
  provider: 'Anthropic' | 'OpenAI'
  model: import('./rerank.js').RerankModel
  candidateCount: number
  totalResultCount: number
  /** The API key is constructor state and is deliberately absent from this body. */
  requestBody: { [key: string]: JsonValue }
}

export interface ClaudeRerankReview {
  preview: ClaudeRerankPreview
  /** True when this outbound-data policy has not yet been accepted on this device. */
  consentRequired: boolean
  /** One-use main-process capability bound to this exact preview. */
  approvalToken: string
}

export type ThemeChoice = 'system' | 'light' | 'dark'

export interface AppSettings {
  language: import('./i18n.js').Language
  watchedFolder: string | null
  theme: ThemeChoice
  /** Whether optional AI reranking is enabled for the selected provider. */
  rerankEnabled: boolean
  rerankProvider: import('./rerank.js').RerankProvider
  rerankModel: import('./rerank.js').RerankModel
  rerankModels: Record<import('./rerank.js').RerankProvider, import('./rerank.js').RerankModel>
  /** True when a key is stored. The key itself never reaches the renderer. */
  hasApiKey: boolean
  /** Detectable without decrypting or prompting the operating-system keychain. */
  apiKeyStatus: 'none' | 'protected' | 'migration-needed'
  rerankConsentGranted: boolean
}

export interface DbStats {
  resumeCount: number
  chunkCount: number
  dbPath: string
  dbSizeBytes: number
}

export interface BackupSummary {
  schemaVersion: number
  resumeCount: number
  chunkCount: number
  path: string
}

/** Commands the application menu sends to the renderer. */
export type MenuCommand =
  | 'new-job'
  | 'import-files'
  | 'import-folder'
  | 'goto-jobs'
  | 'goto-library'
  | 'goto-settings'

export type ModelStatus =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; message: string }
