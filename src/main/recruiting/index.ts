import type { SavedHiringBudget } from '@shared/hiring-budget.js'
/** Main-process ownership of persistent local recruiting workspaces. */
import { createHash, randomUUID } from 'node:crypto'
import { blobToVector, getDb, getSetting, listResumes } from '../db/index.js'
import { MODEL_ID } from '../embed/protocol.js'
import { embedder } from '../embed/client.js'
import { isIndexCommitted } from '../embed/reindex.js'
import { SKILL_GAZETTEER_VERSION } from '../ingest/skills-backfill-plan.js'
import { RESUME_DERIVATION_VERSION } from '../ingest/derivation-version.js'
import { search } from '../search/rank.js'
import { searchSessions } from '../search/sessions.js'
import { RERANK_LIMIT } from '../search/rerankPrivacy.js'
import { DEFAULT_RERANK_CONFIG, type RerankConfig } from '@shared/rerank.js'
import { candidateWithProfile, profileForResume } from '@shared/recruiting.js'
import type { CandidateProfile, CandidateReview, Company, JobPlacement, JobPlacementCandidate, JobWorkspace, SavedJob } from '@shared/recruiting.js'
import type { MatchResult, ResumeRef, ResumeSummary, SectionKind } from '@shared/types.js'
import { assertJobCompanyReferences, parseRecruiting, recruitingSchemas, RECRUITING_LIMITS, recordId, type JobRecord, type SnapshotRecord } from './schema.js'
import { putRecord, readRecord, readRecords, replaceExistingRecords, nowAfter, requireResume } from './storage.js'
import { temporarySearch } from './temporary.js'
import { assertTalentVersionLink } from './talent.js'
import { samePlacementPeople } from './job-status.js'
import { applySavedRerank, deduplicateVersions, emptyProfile, isShortlisted, mergeProfiles, mergeReviews, passageExcerpt, postingText, suggestSemanticCriterionEvidence } from './planning.js'

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function modelFingerprint(): string {
  return digest(['recruiting-ranking-v3-unique-criteria', MODEL_ID, RESUME_DERIVATION_VERSION, SKILL_GAZETTEER_VERSION, getSetting('embeddingModel')])
}
function postingFingerprint(job: JobRecord): string {
  return digest([job.posting, job.criteria])
}
function libraryFingerprint(resumes: ResumeSummary[]): string {
  return digest(resumes.map((resume) => [resume.recordKey, resume.importedAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}
function versionsFingerprint(profiles: CandidateProfile[]): string {
  return digest(profiles.map((profile) => [profile.candidateKey, [...profile.recordKeys].sort()]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}
function requireJob(input: unknown): JobRecord {
  const id = parseRecruiting(recruitingSchemas.jobId, input)
  const job = readRecord<JobRecord>(getDb(), 'job', id)
  if (!job) throw new Error('This saved job no longer exists.')
  return job
}
function workspaceRecord(input: unknown): { job: JobRecord; snapshot: SnapshotRecord | null; temporary: boolean } {
  const id = parseRecruiting(recruitingSchemas.jobId, input)
  const transient = temporarySearch.get(id)
  if (transient) return { ...transient, temporary: true }
  const job = requireJob(id)
  return { job, snapshot: readRecord<SnapshotRecord>(getDb(), 'snapshot', id), temporary: false }
}

function reviewsForJob(id: string): CandidateReview[] {
  return readRecords<CandidateReview>(getDb(), 'review').filter((review) => review.jobId === id)
}

export function listProfiles(): CandidateProfile[] {
  return readRecords<CandidateProfile>(getDb(), 'profile')
}

export function listCompanies(): Company[] {
  return readRecords<Company>(getDb(), 'company').sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function saveCompany(input: unknown): Company {
  const args = parseRecruiting(recruitingSchemas.saveCompany, input)
  const previous = args.id ? readRecord<Company>(getDb(), 'company', args.id) : null
  if (args.id && !previous) throw new Error('This company no longer exists.')
  const now = Math.max(Date.now(), (previous?.updatedAt ?? -1) + 1)
  const company: Company = { ...args, id: previous?.id ?? randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now }
  putRecord(getDb(), 'company', company)
  return company
}

function requireJobCompanies(job: Pick<JobRecord, 'companyId' | 'targetCompanies'>): void {
  assertJobCompanyReferences(job, new Set(listCompanies().map((company) => company.id)))
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
  if (previous && args.status !== previous.status) throw new Error('Use Change status to record a job status change.')
  if (!previous && args.status !== 'open') throw new Error('New jobs start open. Save the job before changing its status.')
  const now = Math.max(Date.now(), (previous?.updatedAt ?? -1) + 1)
  const job: JobRecord = {
    ...previous,
    ...(args.companyId !== undefined ? { companyId: args.companyId } : {}),
    ...(args.budget !== undefined ? { budget: args.budget } : {}),
    ...(args.hiringBudget !== undefined ? { hiringBudget: args.hiringBudget } : {}),
    ...(args.targetCompanies !== undefined ? { targetCompanies: args.targetCompanies } : {}),
    id: previous?.id ?? randomUUID(), posting: args.posting, status: args.status, criteria: args.criteria,
    createdAt: previous?.createdAt ?? now, updatedAt: now, lastSearchedAt: previous?.lastSearchedAt ?? null,
    ...(!previous ? { statusHistory: [{ id: randomUUID(), status: 'open' as const, at: now, kind: 'created' as const }] } : {})
  }
  requireJobCompanies(job)
  if (previous && (previous.companyId ?? null) !== (job.companyId ?? null) && readRecords<SavedHiringBudget>(getDb(), 'hiringBudget').some((plan) => plan.jobId === job.id)) {
    throw new Error('Detach this job from its hiring budget plans before changing its company.')
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

/** Research progress changes only job metadata, preserving matches and decisions. */
export function saveTargetCompanies(input: unknown): JobWorkspace {
  const args = parseRecruiting(recruitingSchemas.saveTargetCompanies, input)
  const previous = requireJob(args.jobId)
  if (previous.updatedAt !== args.expectedUpdatedAt) throw new Error('This job changed. Reopen it before updating target companies.')
  const job: JobRecord = { ...previous, targetCompanies: args.companies, updatedAt: nowAfter(previous) }
  requireJobCompanies(job)
  putRecord(getDb(), 'job', job)
  return getJob(job.id)
}

/** Only this operation can transition a saved job or record who filled it. */
export function changeJobStatus(input: unknown): JobWorkspace {
  const args = parseRecruiting(recruitingSchemas.changeJobStatus, input)
  const previous = requireJob(args.jobId)
  if (previous.updatedAt !== args.expectedUpdatedAt) throw new Error('This job changed. Reopen it before changing its status.')
  let placement: JobPlacement | undefined
  if (args.placement) {
    const profiles = listProfiles()
    const resumes = listResumes()
    const selected = new Set<string>()
    const snapshot = (ref: ResumeRef): JobPlacementCandidate => {
      requireResume(getDb(), ref)
      const profile = profileForResume(profiles, ref.recordKey)
      const candidateKey = profile?.candidateKey ?? ref.recordKey
      if (selected.has(candidateKey)) throw new Error('Choose a different candidate for each hiring slot. Linked CV versions belong to the same person.')
      selected.add(candidateKey)
      const resume = resumes.find((candidate) => candidate.id === ref.id && candidate.recordKey === ref.recordKey)!
      const name = (candidateWithProfile(resume, profile).name?.trim() || resume.fileName)
        .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 512) || 'Unnamed candidate'
      return { recordKey: ref.recordKey, name }
    }
    placement = {
      hired: snapshot(args.placement.hired),
      backup2: args.placement.backup2 ? snapshot(args.placement.backup2) : null,
      backup3: args.placement.backup3 ? snapshot(args.placement.backup3) : null
    }
  }
  const statusChanged = previous.status !== args.status
  const placementChanged = placement !== undefined && !samePlacementPeople(placement, previous.placement)
  if (!statusChanged && !placementChanged) return getJob(previous.id)
  const history = previous.statusHistory ?? []
  if (history.length >= RECRUITING_LIMITS.statusEvents) throw new Error('This job has reached its 1,000-entry status history limit. Its existing history has been preserved.')
  const now = nowAfter(previous)
  putRecord(getDb(), 'job', {
    ...previous, status: args.status, updatedAt: now,
    ...(placement ? { placement } : {}),
    statusHistory: [...history, {
      id: randomUUID(), status: args.status, at: now,
      kind: statusChanged ? 'status-changed' : 'placement-updated',
      ...(placement ? { placement } : {})
    }]
  })
  return getJob(previous.id)
}

interface StoredPassage { resumeId: number; section: SectionKind; ordinal: number; text: string }

export function getJob(input: unknown): JobWorkspace {
  const { job, snapshot, temporary } = workspaceRecord(input)
  const profiles = listProfiles()
  const resumes = listResumes()
  const reviews = temporary ? [] : reviewsForJob(job.id)
  const decorated = decorateJob(job, snapshot, resumes, profiles, reviews)
  if (!snapshot) return { job: decorated, response: null, profiles, reviews, evidence: {}, temporary }
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
  const { results: candidates, reranked } = applySavedRerank(deduplicateVersions(results, profiles), snapshot.rerank)
  const session = searchSessions.create(query, {
    // Bound retained evidence, while returning the complete job list to the UI.
    results: candidates.slice(0, 50), requiredSkills: snapshot.requiredSkills, totalCandidates: candidates.length, elapsedMs: snapshot.elapsedMs, reranked,
    ...(reranked ? { rerankConfig: snapshot.rerankConfig ?? DEFAULT_RERANK_CONFIG } : {})
  }, { jobId: job.id, snapshotFingerprint: digest(snapshot), versionsFingerprint: versionsFingerprint(profiles) })
  if (temporary) temporarySearch.rememberSession(searchSessions.get(session.sessionId))
  return { job: decorated, response: { ...session, results: candidates }, profiles, reviews, evidence: {}, temporary }
}

/** Bind every outbound step to the job and exact local snapshot the user saw. */
function workspaceSessionSource(input: unknown, retainTemporary = false): ReturnType<typeof searchSessions.get> {
  const { jobId, sessionId } = parseRecruiting(recruitingSchemas.rerankPreview, input)
  const session = (retainTemporary ? temporarySearch.getSession(sessionId) : null) ?? searchSessions.get(sessionId)
  const { job, snapshot } = workspaceRecord(jobId)
  if (!snapshot || session.job?.jobId !== jobId || session.job.snapshotFingerprint !== digest(snapshot) ||
      session.job.versionsFingerprint !== versionsFingerprint(listProfiles()) ||
      snapshot.postingFingerprint !== postingFingerprint(job) ||
      snapshot.libraryFingerprint !== libraryFingerprint(listResumes()) || snapshot.modelFingerprint !== modelFingerprint()) {
    throw new Error('The job or its matches changed. Reopen the job and refresh matches before reranking.')
  }
  return session
}

export function jobRerankSource(input: unknown): ReturnType<typeof searchSessions.get> {
  const session = workspaceSessionSource(input)
  if (session.response.results.length < 2) throw new Error('At least two candidates are needed for reranking.')
  return session
}

/** Only order/reasons change. Source scores, all later candidates and reviews remain intact. */
export function saveJobRerank(input: unknown, ordered: MatchResult[], config: RerankConfig = DEFAULT_RERANK_CONFIG): JobWorkspace {
  const args = parseRecruiting(recruitingSchemas.rerankPreview, input)
  const session = jobRerankSource(args)
  const expected = new Set(session.response.results.slice(0, RERANK_LIMIT).map((result) => result.resume.recordKey))
  const leading = ordered.slice(0, RERANK_LIMIT)
  if (leading.length !== expected.size || new Set(leading.map((result) => result.resume.recordKey)).size !== expected.size || leading.some((result) => !expected.has(result.resume.recordKey))) {
    throw new Error('The model did not return a usable ranking.')
  }
  const { snapshot, temporary } = workspaceRecord(args.jobId)
  const reranked = { ...snapshot!, rerankConfig: config, rerank: leading.map((result) => ({ recordKey: result.resume.recordKey, ...(result.llmReason ? { reason: result.llmReason } : {}) })) }
  if (temporary) temporarySearch.updateSnapshot(args.jobId, reranked)
  else putRecord(getDb(), 'snapshot', reranked)
  return getJob(args.jobId)
}

/** Scorecard evidence is loaded only for the open candidate or comparison. */
export async function getEvidence(input: unknown): Promise<JobWorkspace['evidence']> {
  const { jobId, resumes } = parseRecruiting(recruitingSchemas.evidence, input)
  const { job } = workspaceRecord(jobId)
  resumes.forEach((ref) => requireResume(getDb(), ref))
  if (!job.criteria.length) return Object.fromEntries(resumes.map((resume) => [resume.recordKey, []]))
  if (!isIndexCommitted()) throw new Error('The search index is being updated. Try requirement evidence again when it is ready.')
  const libraryAtStart = libraryFingerprint(listResumes())
  const modelAtStart = modelFingerprint()
  // One bounded embedding request, shared by every selected candidate. Source
  // excerpts and recruiter importance do not enter these retrieval queries.
  const texts = [...new Set(job.criteria.map((criterion) => criterion.text))]
  const vectors = await embedder.embedQueries(texts)
  const byText = new Map(texts.map((text, index) => [text, vectors[index]]))
  const current = workspaceRecord(jobId).job
  if (!isIndexCommitted() || modelAtStart !== modelFingerprint() || libraryAtStart !== libraryFingerprint(listResumes()) || postingFingerprint(job) !== postingFingerprint(current)) {
    throw new Error('The job or library changed while finding requirement evidence. Reopen the candidate and try again.')
  }
  const statement = getDb().prepare('SELECT section, text, embedding FROM chunks WHERE resume_id = ? ORDER BY ordinal')
  return Object.fromEntries(resumes.map((resume) => {
    requireResume(getDb(), resume)
    const rows = statement.all(resume.id) as Array<StoredPassage & { embedding: Buffer }>
    return [resume.recordKey, suggestSemanticCriterionEvidence(job.criteria,
      rows.map((row) => ({ section: row.section, text: row.text, vector: blobToVector(row.embedding) })),
      job.criteria.map((criterion) => byText.get(criterion.text)!))]
  }))
}

async function matchJob(job: JobRecord): Promise<SnapshotRecord> {
  const resumes = listResumes()
  const libraryAtStart = libraryFingerprint(resumes)
  const modelAtStart = modelFingerprint()
  const response = await search(postingText(job.posting, job.criteria), 5_000)
  // Embedding yields: a concurrent library change must never commit a mixed snapshot.
  if (libraryAtStart !== libraryFingerprint(listResumes()) || modelAtStart !== modelFingerprint()) throw new Error('The job or library changed during matching. Refresh matches again.')
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
  return snapshot
}

export async function searchJob(input: unknown): Promise<JobWorkspace> {
  const source = workspaceRecord(input)
  const generation = source.temporary ? temporarySearch.begin() : null
  const snapshot = await matchJob(source.job)
  const current = workspaceRecord(source.job.id)
  if (source.temporary !== current.temporary || postingFingerprint(source.job) !== postingFingerprint(current.job) ||
      snapshot.libraryFingerprint !== libraryFingerprint(listResumes()) || snapshot.modelFingerprint !== modelFingerprint()) throw new Error('The job or library changed during matching. Refresh matches again.')
  const job = { ...current.job, lastSearchedAt: snapshot.searchedAt }
  if (generation !== null) temporarySearch.publish(generation, { job, snapshot })
  else getDb().transaction(() => {
    putRecord(getDb(), 'snapshot', snapshot)
    putRecord(getDb(), 'job', job)
  })()
  searchSessions.clearJob(job.id)
  return getJob(job.id)
}

export async function searchTemporary(input: unknown): Promise<JobWorkspace> {
  const args = parseRecruiting(recruitingSchemas.temporarySearch, input)
  requireJobCompanies(args)
  const generation = temporarySearch.begin()
  const now = Date.now()
  const job: JobRecord = { ...args, id: randomUUID(), createdAt: now, updatedAt: now, lastSearchedAt: null }
  const snapshot = await matchJob(job)
  if (snapshot.libraryFingerprint !== libraryFingerprint(listResumes()) || snapshot.modelFingerprint !== modelFingerprint()) throw new Error('The job or library changed during matching. Refresh matches again.')
  const previousId = temporarySearch.id
  temporarySearch.publish(generation, { job: { ...job, lastSearchedAt: snapshot.searchedAt }, snapshot })
  if (previousId) searchSessions.clearJob(previousId)
  return getJob(job.id)
}

export function discardTemporary(input: unknown): void {
  const id = parseRecruiting(recruitingSchemas.jobId, input)
  if (temporarySearch.discard(id)) searchSessions.clearJob(id)
}

export function saveTemporary(input: unknown): JobWorkspace {
  const args = parseRecruiting(recruitingSchemas.rerankPreview, input)
  workspaceSessionSource(args, true)
  const transient = temporarySearch.get(args.jobId)
  if (!transient) throw new Error('This temporary search is no longer available.')
  requireJobCompanies(transient.job)
  // Promotion writes the full snapshot, not the bounded 50-candidate rerank session.
  // A new ID prevents outstanding temporary capabilities from addressing the saved job.
  const id = randomUUID()
  const now = Date.now()
  getDb().transaction(() => {
    putRecord(getDb(), 'job', {
      ...transient.job, id, status: 'open', createdAt: now, updatedAt: now,
      statusHistory: [{ id: randomUUID(), status: 'open', at: now, kind: 'created' }]
    })
    putRecord(getDb(), 'snapshot', { ...transient.snapshot, jobId: id })
  })()
  discardTemporary(args.jobId)
  return getJob(id)
}

export function getTemporaryExport(input: unknown): { jobTitle: string; requiredSkills: string[]; results: MatchResult[] } {
  const args = parseRecruiting(recruitingSchemas.rerankPreview, input)
  const source = workspaceSessionSource(args, true)
  const transient = temporarySearch.get(args.jobId)
  if (!transient) throw new Error('This temporary search is no longer available.')
  if (!source.response.results.length) throw new Error('Find matching candidates before exporting.')
  const profiles = listProfiles()
  return {
    jobTitle: transient.job.posting.position.trim() || 'Candidate shortlist',
    requiredSkills: source.response.requiredSkills,
    results: source.response.results.slice(0, 3).map((result) => ({ ...result, resume: candidateWithProfile(result.resume, profileForResume(profiles, result.resume.recordKey)) }))
  }
}

export function saveReview(input: unknown): CandidateReview {
  const args = parseRecruiting(recruitingSchemas.saveReview, input)
  requireResume(getDb(), args.resume)
  const job = requireJob(args.jobId)
  if (args.assessments.some((assessment) => !job.criteria.some((criterion) => criterion.id === assessment.criterionId))) throw new Error('A requirement changed. Reopen this job before saving the scorecard.')
  const candidateKey = profileForResume(listProfiles(), args.resume.recordKey)?.candidateKey ?? args.resume.recordKey
  const review: CandidateReview = { jobId: job.id, candidateKey, status: args.status, note: args.note, order: args.order, assessments: args.assessments, updatedAt: Date.now() }
  putRecord(getDb(), 'review', review)
  return review
}

export function saveProfile(input: unknown): CandidateProfile {
  const { resume, ...fields } = parseRecruiting(recruitingSchemas.saveProfile, input)
  requireResume(getDb(), resume)
  const previous = profileForResume(listProfiles(), resume.recordKey) ?? emptyProfile(resume.recordKey)
  const profile = { ...previous, ...fields, updatedAt: Date.now() }
  putRecord(getDb(), 'profile', profile)
  return profile
}

export function linkVersions(input: unknown): CandidateProfile {
  const args = parseRecruiting(recruitingSchemas.linkVersions, input)
  requireResume(getDb(), args.primary)
  requireResume(getDb(), args.version)
  const profiles = listProfiles()
  const primary = profileForResume(profiles, args.primary.recordKey) ?? emptyProfile(args.primary.recordKey)
  const version = profileForResume(profiles, args.version.recordKey) ?? emptyProfile(args.version.recordKey)
  if (primary.candidateKey === version.candidateKey) return primary
  assertTalentVersionLink(primary.recordKeys, version.recordKeys)
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
  requireResume(getDb(), resume)
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
  requireJob(jobId)
  const workspace = getJob(jobId)
  const selected = workspace.reviews.filter((review) => isShortlisted(review.status))
  const byCandidate = new Map((workspace.response?.results ?? []).map((result) => [profileForResume(workspace.profiles, result.resume.recordKey)?.candidateKey ?? result.resume.recordKey, result.resume]))
  const expected = new Map(selected.map((review) => [byCandidate.get(review.candidateKey)?.recordKey, review]))
  if (expected.has(undefined) || resumes.length !== selected.length || resumes.some((resume) => !expected.has(resume.recordKey))) throw new Error('The shortlist changed. Refresh this job before reordering candidates.')
  getDb().transaction(() => {
    const updates = resumes.map((resume, order) => {
      requireResume(getDb(), resume)
      const review = expected.get(resume.recordKey)!
      return { ...review, order }
    })
    replaceExistingRecords(getDb(), 'review', updates)
  })()
}

export function getShortlistExport(input: unknown): { jobTitle: string; requiredSkills: string[]; results: MatchResult[]; notes: Record<string, string> } {
  requireJob(input)
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
