/** Main-process ownership of persistent local recruiting workspaces. */
import { createHash, randomUUID } from 'node:crypto'
import { getDb, getSetting, listResumes } from '../db/index.js'
import { MODEL_ID } from '../embed/protocol.js'
import { SKILL_GAZETTEER_VERSION } from '../ingest/skills-backfill-plan.js'
import { search } from '../search/rank.js'
import { searchSessions } from '../search/sessions.js'
import { candidateWithProfile, profileForResume } from '@shared/recruiting.js'
import type { CandidateProfile, CandidateReview, JobWorkspace, SavedJob } from '@shared/recruiting.js'
import type { MatchResult, ResumeRef, ResumeSummary, SectionKind } from '@shared/types.js'
import { parseRecruiting, recruitingSchemas, recordId, type JobRecord, type SnapshotRecord } from './schema.js'
import { putRecord, readRecord, readRecords, replaceExistingRecords } from './storage.js'
import { deduplicateVersions, emptyProfile, isShortlisted, mergeProfiles, mergeReviews, passageExcerpt, postingText, suggestCriterionEvidence } from './planning.js'

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function modelFingerprint(): string {
  return digest(['recruiting-ranking-v1', MODEL_ID, SKILL_GAZETTEER_VERSION, getSetting('embeddingModel')])
}
function postingFingerprint(job: JobRecord): string {
  return digest([job.posting, job.criteria])
}
function libraryFingerprint(resumes: ResumeSummary[]): string {
  return digest(resumes.map((resume) => [resume.recordKey, resume.importedAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}
function requireJob(input: unknown): JobRecord {
  const id = parseRecruiting(recruitingSchemas.jobId, input)
  const job = readRecord<JobRecord>(getDb(), 'job', id)
  if (!job) throw new Error('This saved job no longer exists.')
  return job
}
function requireResume(ref: ResumeRef): void {
  if (!getDb().prepare('SELECT 1 FROM resumes WHERE id = ? AND content_hash = ?').get(ref.id, ref.recordKey)) throw new Error('This CV changed or was removed. Refresh the library and try again.')
}
function reviewsForJob(id: string): CandidateReview[] {
  return readRecords<CandidateReview>(getDb(), 'review').filter((review) => review.jobId === id)
}

export function listProfiles(): CandidateProfile[] {
  return readRecords<CandidateProfile>(getDb(), 'profile')
}

function decorateJob(job: JobRecord, snapshot: SnapshotRecord | null, resumes: ResumeSummary[], profiles: CandidateProfile[], reviews: CandidateReview[]): SavedJob {
  const currentKeys = new Set(resumes.map((resume) => resume.recordKey))
  const owners = new Map(profiles.flatMap((profile) => profile.recordKeys.map((key) => [key, profile.candidateKey] as const)))
  const currentCandidates = new Set(resumes.map((resume) => owners.get(resume.recordKey) ?? resume.recordKey))
  const knownKeys = new Set(snapshot?.libraryKeys ?? [])
  const candidates = new Set((snapshot?.results ?? []).filter((result) => currentKeys.has(result.recordKey)).map((result) => owners.get(result.recordKey) ?? result.recordKey))
  const unseen = resumes.filter((resume) => snapshot ? !knownKeys.has(resume.recordKey) : job.lastSearchedAt !== null && resume.importedAt > job.lastSearchedAt)
  return {
    ...job,
    candidateCount: candidates.size,
    shortlistCount: reviews.filter((review) => review.jobId === job.id && isShortlisted(review.status) && currentCandidates.has(review.candidateKey)).length,
    newResumeCount: new Set(unseen.map((resume) => owners.get(resume.recordKey) ?? resume.recordKey)).size,
    stale: snapshot ? snapshot.libraryFingerprint !== libraryFingerprint(resumes) || snapshot.postingFingerprint !== postingFingerprint(job) || snapshot.modelFingerprint !== modelFingerprint() : job.lastSearchedAt !== null
  }
}

export function listJobs(): SavedJob[] {
  const resumes = listResumes()
  const profiles = listProfiles()
  const reviews = readRecords<CandidateReview>(getDb(), 'review')
  const snapshots = new Map(readRecords<SnapshotRecord>(getDb(), 'snapshot').map((snapshot) => [snapshot.jobId, snapshot]))
  return readRecords<JobRecord>(getDb(), 'job').map((job) => decorateJob(job, snapshots.get(job.id) ?? null, resumes, profiles, reviews)).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveJob(input: unknown): SavedJob {
  const args = parseRecruiting(recruitingSchemas.saveJob, input)
  const previous = args.id ? requireJob(args.id) : null
  const now = Date.now()
  const job: JobRecord = {
    id: previous?.id ?? randomUUID(), posting: args.posting, status: args.status, criteria: args.criteria,
    createdAt: previous?.createdAt ?? now, updatedAt: now, lastSearchedAt: previous?.lastSearchedAt ?? null
  }
  getDb().transaction(() => {
    putRecord(getDb(), 'job', job)
    if (previous) {
      // An edited requirement cannot inherit a previous confirmation merely by
      // retaining its UI identifier. Unchanged criteria retain recruiter work.
      const retained = new Set(job.criteria.filter((criterion) => previous.criteria.some((old) => old.id === criterion.id && old.text === criterion.text)).map((criterion) => criterion.id))
      for (const review of reviewsForJob(job.id)) {
        const assessments = review.assessments.filter((assessment) => retained.has(assessment.criterionId))
        if (assessments.length !== review.assessments.length) putRecord(getDb(), 'review', { ...review, assessments })
      }
    }
  })()
  return decorateJob(job, readRecord<SnapshotRecord>(getDb(), 'snapshot', job.id), listResumes(), listProfiles(), reviewsForJob(job.id))
}

interface StoredPassage { resumeId: number; section: SectionKind; ordinal: number; text: string }

export function getJob(input: unknown): JobWorkspace {
  const job = requireJob(input)
  const snapshot = readRecord<SnapshotRecord>(getDb(), 'snapshot', job.id)
  const profiles = listProfiles()
  const resumes = listResumes()
  const reviews = reviewsForJob(job.id)
  const decorated = decorateJob(job, snapshot, resumes, profiles, reviews)
  if (!snapshot) return { job: decorated, response: null, profiles, reviews, evidence: {} }
  const byKey = new Map(resumes.map((resume) => [resume.recordKey, resume]))
  const passageAt = getDb().prepare('SELECT section, text FROM chunks WHERE resume_id = ? AND ordinal = ? LIMIT 1')
  const query = postingText(job.posting, job.criteria)
  const results: MatchResult[] = []
  for (const stored of snapshot.results) {
    const resume = byKey.get(stored.recordKey)
    if (!resume) continue
    const evidence = stored.evidence.flatMap((item) => {
      const chunk = passageAt.get(resume.id, item.ordinal) as StoredPassage | undefined
      return chunk ? [{ section: chunk.section, text: passageExcerpt(chunk.text, query), similarity: item.similarity }] : []
    })
    results.push({ resume, score: stored.score, breakdown: stored.breakdown, matchedSkills: stored.matchedSkills, missingSkills: stored.missingSkills, evidence })
  }
  const candidates = deduplicateVersions(results, profiles)
  const session = searchSessions.create(query, {
    // Only the same bounded candidate set as an ordinary Match search may be
    // retained for optional reranking. The complete job list is returned once.
    results: candidates.slice(0, 50), requiredSkills: snapshot.requiredSkills, totalCandidates: candidates.length, elapsedMs: snapshot.elapsedMs
  })
  return { job: decorated, response: { ...session, results: candidates }, profiles, reviews, evidence: {} }
}

/** Scorecard evidence is loaded only for the open candidate or comparison. */
export function getEvidence(input: unknown): JobWorkspace['evidence'] {
  const { jobId, resumes } = parseRecruiting(recruitingSchemas.evidence, input)
  const job = requireJob(jobId)
  const statement = getDb().prepare('SELECT section, ordinal, text FROM chunks WHERE resume_id = ? ORDER BY ordinal')
  return Object.fromEntries(resumes.map((resume) => {
    requireResume(resume)
    const passages = statement.all(resume.id) as StoredPassage[]
    return [resume.recordKey, suggestCriterionEvidence(job.criteria, passages)]
  }))
}

export async function searchJob(input: unknown): Promise<JobWorkspace> {
  const job = requireJob(input)
  const resumes = listResumes()
  const libraryAtStart = libraryFingerprint(resumes)
  const modelAtStart = modelFingerprint()
  const response = await search(postingText(job.posting, job.criteria), 5_000)
  const current = requireJob(job.id)
  // Embedding yields: a concurrent import, job edit, or restore must never
  // commit a mixed snapshot as though it describes the current workspace.
  if (libraryAtStart !== libraryFingerprint(listResumes()) || postingFingerprint(job) !== postingFingerprint(current) || modelAtStart !== modelFingerprint()) throw new Error('The job or library changed during matching. Refresh matches again.')
  const passageIdentity = getDb().prepare('SELECT ordinal FROM chunks WHERE resume_id = ? AND section = ? AND text = ? LIMIT 1')
  const snapshot: SnapshotRecord = {
    jobId: job.id, libraryFingerprint: libraryAtStart, postingFingerprint: postingFingerprint(job), modelFingerprint: modelAtStart,
    searchedAt: Date.now(), libraryKeys: resumes.map((resume) => resume.recordKey), requiredSkills: response.requiredSkills, elapsedMs: response.elapsedMs,
    results: response.results.map((result) => ({
      recordKey: result.resume.recordKey, score: result.score, breakdown: result.breakdown, matchedSkills: result.matchedSkills, missingSkills: result.missingSkills,
      evidence: result.evidence.map((item) => {
        const passage = passageIdentity.get(result.resume.id, item.section, item.text) as { ordinal: number } | undefined
        if (!passage) throw new Error('Candidate evidence changed during matching. Refresh matches again.')
        return { ordinal: passage.ordinal, similarity: Math.max(-1, Math.min(1, item.similarity)) }
      })
    }))
  }
  getDb().transaction(() => {
    putRecord(getDb(), 'snapshot', snapshot)
    putRecord(getDb(), 'job', { ...current, lastSearchedAt: snapshot.searchedAt })
  })()
  return getJob(job.id)
}

export function saveReview(input: unknown): CandidateReview {
  const args = parseRecruiting(recruitingSchemas.saveReview, input)
  requireResume(args.resume)
  const job = requireJob(args.jobId)
  if (args.assessments.some((assessment) => !job.criteria.some((criterion) => criterion.id === assessment.criterionId))) throw new Error('A requirement changed. Reopen this job before saving the scorecard.')
  const candidateKey = profileForResume(listProfiles(), args.resume.recordKey)?.candidateKey ?? args.resume.recordKey
  const review: CandidateReview = { jobId: job.id, candidateKey, status: args.status, note: args.note, order: args.order, assessments: args.assessments, updatedAt: Date.now() }
  putRecord(getDb(), 'review', review)
  return review
}

export function saveProfile(input: unknown): CandidateProfile {
  const { resume, ...fields } = parseRecruiting(recruitingSchemas.saveProfile, input)
  requireResume(resume)
  const previous = profileForResume(listProfiles(), resume.recordKey) ?? emptyProfile(resume.recordKey)
  const profile = { ...previous, ...fields, updatedAt: Date.now() }
  putRecord(getDb(), 'profile', profile)
  return profile
}

export function linkVersions(input: unknown): CandidateProfile {
  const args = parseRecruiting(recruitingSchemas.linkVersions, input)
  requireResume(args.primary)
  requireResume(args.version)
  const profiles = listProfiles()
  const primary = profileForResume(profiles, args.primary.recordKey) ?? emptyProfile(args.primary.recordKey)
  const version = profileForResume(profiles, args.version.recordKey) ?? emptyProfile(args.version.recordKey)
  if (primary.candidateKey === version.candidateKey) return primary
  const merged = mergeProfiles(primary, version)
  const reviews = readRecords<CandidateReview>(getDb(), 'review')
  const transferred = reviews.filter((review) => review.candidateKey === version.candidateKey).map((review) => {
    const existing = reviews.find((other) => other.jobId === review.jobId && other.candidateKey === primary.candidateKey)
    return existing ? mergeReviews(existing, review) : { ...review, candidateKey: primary.candidateKey }
  })
  getDb().transaction(() => {
    const remove = getDb().prepare('DELETE FROM recruiting_records WHERE kind = ? AND id = ?')
    remove.run('profile', version.candidateKey)
    putRecord(getDb(), 'profile', merged)
    for (const review of transferred) {
      remove.run('review', `${review.jobId}:${version.candidateKey}`)
      putRecord(getDb(), 'review', review)
    }
  })()
  searchSessions.clear()
  return merged
}

export function unlinkVersion(input: unknown): void {
  const { resume } = parseRecruiting(recruitingSchemas.unlinkVersion, input)
  requireResume(resume)
  const profile = profileForResume(listProfiles(), resume.recordKey)
  if (!profile || profile.recordKeys.length < 2) return
  const remainingKeys = profile.recordKeys.filter((key) => key !== resume.recordKey)
  const remainingKey = profile.candidateKey === resume.recordKey ? remainingKeys[0] : profile.candidateKey
  const now = Date.now()
  const reviews = readRecords<CandidateReview>(getDb(), 'review').filter((review) => review.candidateKey === profile.candidateKey)
  getDb().transaction(() => {
    getDb().prepare("DELETE FROM recruiting_records WHERE kind = 'profile' AND id = ?").run(profile.candidateKey)
    putRecord(getDb(), 'profile', { ...profile, candidateKey: remainingKey, recordKeys: remainingKeys, updatedAt: now })
    putRecord(getDb(), 'profile', { ...profile, candidateKey: resume.recordKey, recordKeys: [resume.recordKey], updatedAt: now })
    for (const review of reviews) {
      getDb().prepare("DELETE FROM recruiting_records WHERE kind = 'review' AND id = ?").run(recordId('review', review))
      // Both resulting people retain the recruiter-entered history. Subsequent
      // decisions are independent, and the UI explains this before unlinking.
      putRecord(getDb(), 'review', { ...review, candidateKey: remainingKey, updatedAt: now })
      putRecord(getDb(), 'review', { ...review, candidateKey: resume.recordKey, updatedAt: now })
    }
  })()
  searchSessions.clear()
}

/** One transaction makes moving a candidate reliable even when old orders tie. */
export function reorderShortlist(input: unknown): void {
  const { jobId, resumes } = parseRecruiting(recruitingSchemas.reorderShortlist, input)
  const workspace = getJob(jobId)
  const selected = workspace.reviews.filter((review) => isShortlisted(review.status))
  const byCandidate = new Map((workspace.response?.results ?? []).map((result) => [profileForResume(workspace.profiles, result.resume.recordKey)?.candidateKey ?? result.resume.recordKey, result.resume]))
  const expected = new Map(selected.map((review) => [byCandidate.get(review.candidateKey)?.recordKey, review]))
  if (expected.has(undefined) || resumes.length !== selected.length || resumes.some((resume) => !expected.has(resume.recordKey))) throw new Error('The shortlist changed. Refresh this job before reordering candidates.')
  getDb().transaction(() => {
    const updates = resumes.map((resume, order) => {
      requireResume(resume)
      const review = expected.get(resume.recordKey)!
      return { ...review, order }
    })
    replaceExistingRecords(getDb(), 'review', updates)
  })()
}

export function getShortlistExport(input: unknown): { jobTitle: string; requiredSkills: string[]; results: MatchResult[]; notes: Record<string, string> } {
  const workspace = getJob(input)
  if (!workspace.response || workspace.job.stale) throw new Error('Refresh this job’s matches before exporting its shortlist.')
  const resultsByKey = new Map(workspace.response.results.map((result) => [profileForResume(workspace.profiles, result.resume.recordKey)?.candidateKey ?? result.resume.recordKey, result]))
  const selected = workspace.reviews.filter((review) => isShortlisted(review.status)).sort((a, b) => a.order - b.order || (resultsByKey.get(a.candidateKey)?.resume.recordKey ?? a.candidateKey).localeCompare(resultsByKey.get(b.candidateKey)?.resume.recordKey ?? b.candidateKey))
  const results: MatchResult[] = []
  const notes: Record<string, string> = {}
  for (const review of selected) {
    const result = resultsByKey.get(review.candidateKey)
    if (!result) throw new Error('A shortlisted candidate has no current searchable CV. Refresh matches and review the shortlist.')
    results.push({ ...result, resume: candidateWithProfile(result.resume, profileForResume(workspace.profiles, result.resume.recordKey)) })
    notes[result.resume.recordKey] = review.note
  }
  if (!results.length) throw new Error('Shortlist at least one candidate before exporting.')
  return { jobTitle: workspace.job.posting.position.trim() || 'Candidate shortlist', requiredSkills: workspace.response.requiredSkills, results, notes }
}
