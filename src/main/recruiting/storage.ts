import type Database from 'better-sqlite3'
import type { CandidateProfile, CandidateReview } from '@shared/recruiting.js'
import { pruneJobPlacements } from './job-status.js'
import {
  parseRecruiting,
  RECRUITING_LIMITS,
  recordId,
  recordSchemas,
  type JobRecord,
  type RecordKind,
  type StoredRecord
} from './schema.js'

export const RECRUITING_TABLE_SQL = `CREATE TABLE recruiting_records (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (kind, id)
)`

type Row = { kind: string; id: string; data: string }

function parseRow(row: Row): StoredRecord {
  if (!Object.hasOwn(recordSchemas, row.kind)) throw new Error('Invalid recruiting record kind.')
  const kind = row.kind as RecordKind
  let json: unknown
  try { json = JSON.parse(row.data) } catch { throw new Error('Invalid recruiting JSON.') }
  const value = parseRecruiting<StoredRecord>(recordSchemas[kind], json)
  if (recordId(kind, value) !== row.id) throw new Error('Invalid recruiting record identity.')
  return value
}

export function readRecords<T extends StoredRecord>(database: Database.Database, kind: RecordKind): T[] {
  return (database.prepare('SELECT kind, id, data FROM recruiting_records WHERE kind = ? ORDER BY id').all(kind) as Row[])
    .map((row) => parseRow(row) as T)
}

export function readRecord<T extends StoredRecord>(database: Database.Database, kind: RecordKind, id: string): T | null {
  const row = database.prepare('SELECT kind, id, data FROM recruiting_records WHERE kind = ? AND id = ?').get(kind, id) as Row | undefined
  return row ? parseRow(row) as T : null
}

export function putRecord(database: Database.Database, kind: RecordKind, input: StoredRecord): void {
  const value = parseRecruiting<StoredRecord>(recordSchemas[kind], input)
  const id = recordId(kind, value)
  const data = JSON.stringify(value)
  const size = Buffer.byteLength(data)
  if (size > RECRUITING_LIMITS.recordBytes) throw new Error('This recruiting record exceeds the storage limit.')
  const usage = database.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(data AS BLOB))), 0) AS bytes,
    COALESCE(SUM(CASE WHEN kind = ? THEN 1 ELSE 0 END), 0) AS kindCount FROM recruiting_records`).get(kind) as { count: number; bytes: number; kindCount: number }
  const previous = database.prepare('SELECT length(CAST(data AS BLOB)) AS bytes FROM recruiting_records WHERE kind = ? AND id = ?').get(kind, id) as { bytes: number } | undefined
  const limit = { job: RECRUITING_LIMITS.jobs, review: RECRUITING_LIMITS.reviews, profile: RECRUITING_LIMITS.profiles, snapshot: RECRUITING_LIMITS.snapshots }[kind]
  if (!previous && usage.kindCount >= limit) throw new Error(`The library has reached its ${limit}-${kind} storage limit.`)
  if (usage.bytes - (previous?.bytes ?? 0) + size > RECRUITING_LIMITS.totalBytes) throw new Error('Recruiting records have reached the 128 MB storage limit.')
  database.prepare('INSERT INTO recruiting_records(kind, id, data) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data').run(kind, id, data)
}

/** Reordering can touch every candidate; check the byte budget once per batch. */
export function replaceExistingRecords(database: Database.Database, kind: RecordKind, inputs: StoredRecord[]): void {
  if (inputs.length === 0) return
  if (inputs.length > 5_000) throw new Error('Too many recruiting records in one update.')
  const records = inputs.map((input) => {
    const value = parseRecruiting<StoredRecord>(recordSchemas[kind], input)
    const data = JSON.stringify(value)
    const bytes = Buffer.byteLength(data)
    if (bytes > RECRUITING_LIMITS.recordBytes) throw new Error('This recruiting record exceeds the storage limit.')
    return { id: recordId(kind, value), data, bytes }
  })
  if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error('Duplicate recruiting records in one update.')
  database.transaction(() => {
    const previousSize = database.prepare('SELECT length(CAST(data AS BLOB)) AS bytes FROM recruiting_records WHERE kind = ? AND id = ?')
    let difference = 0
    for (const record of records) {
      const previous = previousSize.get(kind, record.id) as { bytes: number } | undefined
      if (!previous) throw new Error('A recruiting record changed. Refresh and try again.')
      difference += record.bytes - previous.bytes
    }
    const usage = database.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))), 0) AS bytes FROM recruiting_records').get() as { bytes: number }
    if (usage.bytes + difference > RECRUITING_LIMITS.totalBytes) throw new Error('Recruiting records have reached the 128 MB storage limit.')
    const replace = database.prepare('UPDATE recruiting_records SET data = ? WHERE kind = ? AND id = ?')
    for (const record of records) replace.run(record.data, kind, record.id)
  })()
}

/** Bounded validation of untrusted SQLite data, before any JSON body is materialised. */
export function assertRecruitingData(database: Database.Database): void {
  const aggregate = database.prepare(`SELECT COUNT(*) AS count,
    COALESCE(SUM(length(CAST(data AS BLOB))), 0) AS bytes,
    COALESCE(MAX(length(CAST(data AS BLOB))), 0) AS maxBytes,
    COALESCE(MAX(length(CAST(id AS BLOB))), 0) AS maxId,
    COALESCE(MAX(length(CAST(kind AS BLOB))), 0) AS maxKind FROM recruiting_records`).get() as {
    count: number; bytes: number; maxBytes: number; maxId: number; maxKind: number
  }
  if (aggregate.count > 55_500 || aggregate.bytes > RECRUITING_LIMITS.totalBytes || aggregate.maxBytes > RECRUITING_LIMITS.recordBytes || aggregate.maxId > 101 || aggregate.maxKind > 8) {
    throw new Error('Recruiting records exceed Qumaa safety limits.')
  }
  if (database.prepare(`SELECT 1 FROM recruiting_records WHERE typeof(kind) <> 'text' OR typeof(id) <> 'text'
    OR typeof(data) <> 'text' OR instr(data, char(0)) > 0 LIMIT 1`).get()) throw new Error('Invalid recruiting record storage.')
  const counts = { job: 0, review: 0, profile: 0, snapshot: 0 }
  const jobs = new Map<string, JobRecord>()
  const ownedKeys = new Set<string>()
  const owners = new Map<string, string>()
  const reviews: CandidateReview[] = []
  const snapshotJobs: string[] = []
  for (const row of database.prepare('SELECT kind, id, data FROM recruiting_records ORDER BY kind, id').iterate() as IterableIterator<Row>) {
    const value = parseRow(row)
    counts[row.kind as RecordKind]++
    if (row.kind === 'job') jobs.set(row.id, value as JobRecord)
    if (row.kind === 'profile') {
      const profile = value as CandidateProfile
      for (const key of profile.recordKeys) {
        if (ownedKeys.has(key)) throw new Error('A resume belongs to more than one candidate profile.')
        ownedKeys.add(key)
        owners.set(key, profile.candidateKey)
      }
    }
    if (row.kind === 'review') reviews.push(value as CandidateReview)
    if (row.kind === 'snapshot') snapshotJobs.push(row.id)
  }
  if (counts.job > RECRUITING_LIMITS.jobs || counts.review > RECRUITING_LIMITS.reviews || counts.profile > RECRUITING_LIMITS.profiles || counts.snapshot > RECRUITING_LIMITS.snapshots) throw new Error('Recruiting record counts exceed Qumaa safety limits.')
  for (const review of reviews) {
    const job = jobs.get(review.jobId)
    if (!job || review.assessments.some((assessment) => !job.criteria.some((criterion) => criterion.id === assessment.criterionId))) throw new Error('A candidate review references an unknown job or criterion.')
    if (owners.has(review.candidateKey) && owners.get(review.candidateKey) !== review.candidateKey) throw new Error('A candidate review references an obsolete CV version identity.')
  }
  if (snapshotJobs.some((id) => !jobs.has(id))) throw new Error('A saved search references an unknown job.')
}

/** Deletion removes private notes when the last CV for a person is removed. */
export function pruneRecruitingRecords(database: Database.Database): void {
  const currentKeys = new Set((database.prepare('SELECT content_hash FROM resumes').all() as Array<{ content_hash: string }>).map((row) => row.content_hash))
  const remove = database.prepare('DELETE FROM recruiting_records WHERE kind = ? AND id = ?')
  const candidateKeys = new Set(currentKeys)
  const reassignedKeys = new Map<string, string>()
  for (const profile of readRecords<CandidateProfile>(database, 'profile')) {
    const keys = profile.recordKeys.filter((key) => currentKeys.has(key))
    if (!keys.length) remove.run('profile', profile.candidateKey)
    else {
      const candidateKey = keys.includes(profile.candidateKey) ? profile.candidateKey : keys[0]
      candidateKeys.add(candidateKey)
      if (candidateKey !== profile.candidateKey) {
        remove.run('profile', profile.candidateKey)
        reassignedKeys.set(profile.candidateKey, candidateKey)
      }
      if (keys.length !== profile.recordKeys.length) putRecord(database, 'profile', { ...profile, candidateKey, recordKeys: keys })
    }
  }
  for (const review of readRecords<CandidateReview>(database, 'review')) {
    const newKey = reassignedKeys.get(review.candidateKey)
    if (newKey) {
      remove.run('review', recordId('review', review))
      putRecord(database, 'review', { ...review, candidateKey: newKey })
    } else if (!candidateKeys.has(review.candidateKey)) remove.run('review', recordId('review', review))
  }
  for (const job of readRecords<JobRecord>(database, 'job')) {
    const pruned = pruneJobPlacements(job, currentKeys)
    if (pruned !== job) putRecord(database, 'job', { ...pruned, updatedAt: Math.max(Date.now(), job.updatedAt + 1) })
  }
  // Saved rankings refer only to current CV identities; their source library
  // fingerprint deliberately stays unchanged so the UI requests a refresh.
  for (const snapshot of readRecords<import('./schema.js').SnapshotRecord>(database, 'snapshot')) {
    const results = snapshot.results.filter((result) => currentKeys.has(result.recordKey))
    if (results.length !== snapshot.results.length) {
      // A deleted CV's Claude explanation is private derived text too.
      const { rerank, rerankConfig, ...localSnapshot } = snapshot
      putRecord(database, 'snapshot', {
        ...localSnapshot, results,
        ...(rerank?.every((entry) => currentKeys.has(entry.recordKey)) ? { rerank, ...(rerankConfig ? { rerankConfig } : {}) } : {})
      })
    }
  }
}
