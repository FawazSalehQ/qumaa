/** SQLite storage. Single file under userData; schema created on first open. */
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync, statSync } from 'node:fs'
import { skillLabels } from '../ingest/skills.js'
import { DATABASE_LIMITS, migrateDatabase } from './migrations.js'
import { pruneStaleDatabaseArtifacts, recoverInterruptedRestore } from './replacement.js'
import { pruneRecruitingRecords } from '../recruiting/storage.js'
import { temporarySearch } from '../recruiting/temporary.js'
import type {
  DbStats,
  EducationLevel,
  ResumeDetail,
  ResumeRef,
  ResumeSummary
} from '@shared/types.js'

export interface ResumeRow {
  id: number
  content_hash: string
  file_path: string
  file_name: string
  imported_at: number
  name: string | null
  email: string | null
  phone: string | null
  location: string | null
  years_experience: number | null
  education_level: EducationLevel | null
  skills_json: string
}

/** The narrow row shape used by Library and search; excludes CV text and vectors. */
export const RESUME_ROW_COLUMNS = `id, content_hash, file_path, file_name, imported_at, name, email, phone,
  location, years_experience, education_level, skills_json`

let db: Database.Database | null = null
let recoveryChecked = false
let libraryUsage: LibraryUsage | null = null

interface LibraryUsage {
  resumeCount: number
  chunkCount: number
  rawTextChars: number
  chunkTextChars: number
}

export function getDb(): Database.Database {
  if (db) return db
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'cv_filter.db')
  if (!recoveryChecked) {
    recoverInterruptedRestore(path)
    pruneStaleDatabaseArtifacts(path)
    recoveryChecked = true
  }

  const opened = new Database(path)
  try {
    opened.pragma('journal_mode = WAL')
    opened.pragma('foreign_keys = ON')
    // Deleted or replaced values (especially a migrated legacy plaintext API
    // key) must be overwritten in database pages instead of left recoverable
    // on the freelist.
    opened.pragma('secure_delete = ON')
    migrateDatabase(opened)
    db = opened
    return opened
  } catch (error) {
    opened.close()
    throw error
  }
}

export function dbPath(): string {
  return join(app.getPath('userData'), 'cv_filter.db')
}

/**
 * Checkpoints and closes the managed connection before an atomic restore.
 * Callers must reopen it with `getDb`, including on failure.
 */
export function closeDbForMaintenance(): void {
  if (!db) return
  checkpointWalOrThrow('The library database is still in use and could not be safely replaced.')
  db.close()
  db = null
  libraryUsage = null
}

/** Flushes sanitised pages and removes old WAL frames, failing if another reader blocks it. */
export function checkpointWalOrThrow(message: string): void {
  const checkpoint = getDb().pragma('wal_checkpoint(TRUNCATE)') as Array<{
    busy: number
    log: number
    checkpointed: number
  }>
  const result = checkpoint[0]
  if (!result || result.busy !== 0 || result.log !== result.checkpointed) {
    throw new Error(message)
  }
}

function currentLibraryUsage(): LibraryUsage {
  if (libraryUsage) return libraryUsage
  libraryUsage = getDb()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM resumes) AS resumeCount,
         (SELECT COUNT(*) FROM chunks) AS chunkCount,
         (SELECT COALESCE(SUM(length(raw_text)), 0) FROM resumes) AS rawTextChars,
         (SELECT COALESCE(SUM(length(text)), 0) FROM chunks) AS chunkTextChars`
    )
    .get() as LibraryUsage
  return libraryUsage
}

/**
 * Checks the same aggregate invariants used at startup/restore. Call again
 * inside the insert transaction because embedding yields to other imports.
 */
export function resumeCapacityError(
  rawTextChars: number,
  chunkCount: number,
  chunkTextChars: number
): string | null {
  const usage = currentLibraryUsage()
  if (usage.resumeCount + 1 > DATABASE_LIMITS.resumes) {
    return `The library has reached Qumaa's ${DATABASE_LIMITS.resumes}-resume safety limit.`
  }
  if (usage.chunkCount + chunkCount > DATABASE_LIMITS.chunks) {
    return `The library would exceed Qumaa's ${DATABASE_LIMITS.chunks}-passage safety limit.`
  }
  if (usage.rawTextChars + rawTextChars > DATABASE_LIMITS.totalRawTextChars) {
    return 'The library would exceed Qumaa\'s total resume-text safety limit.'
  }
  if (usage.chunkTextChars + chunkTextChars > DATABASE_LIMITS.totalChunkTextChars) {
    return 'The library would exceed Qumaa\'s total passage-text safety limit.'
  }
  return null
}

/** Updates the in-process aggregate immediately after a committed insert. */
export function recordResumeInserted(
  rawTextChars: number,
  chunkCount: number,
  chunkTextChars: number
): void {
  const usage = currentLibraryUsage()
  usage.resumeCount++
  usage.chunkCount += chunkCount
  usage.rawTextChars += rawTextChars
  usage.chunkTextChars += chunkTextChars
}

export function invalidateLibraryUsage(): void {
  libraryUsage = null
}

/* ---------- vector (de)serialisation ---------- */

export function vectorToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

export function blobToVector(b: Buffer): Float32Array {
  // Copy rather than alias: better-sqlite3 buffers are not guaranteed to be
  // 4-byte aligned, and Float32Array over a misaligned offset throws.
  const copy = new ArrayBuffer(b.byteLength)
  Buffer.from(copy).set(b)
  return new Float32Array(copy, 0, b.byteLength / 4)
}

/* ---------- mapping ---------- */

export function rowToSummary(r: ResumeRow): ResumeSummary {
  return {
    id: r.id,
    recordKey: r.content_hash,
    fileName: r.file_name,
    filePath: r.file_path,
    importedAt: r.imported_at,
    name: r.name,
    email: r.email,
    phone: r.phone,
    location: r.location,
    yearsExperience: r.years_experience,
    educationLevel: r.education_level,
    // Stored as canonical ids; surfaced as display labels so the Library and the
    // Match cards name skills the same way ("CI/CD", not "cicd").
    skills: skillLabels(JSON.parse(r.skills_json) as string[])
  }
}

/* ---------- queries ---------- */

export function findByHash(hash: string): { id: number } | undefined {
  return getDb().prepare('SELECT id FROM resumes WHERE content_hash = ?').get(hash) as
    | { id: number }
    | undefined
}

export function listResumes(): ResumeSummary[] {
  const rows = getDb()
    .prepare(`SELECT ${RESUME_ROW_COLUMNS} FROM resumes ORDER BY imported_at DESC`)
    .all() as ResumeRow[]
  return rows.map(rowToSummary)
}

/** Only the text and count rendered by the detail panel; chunk bodies stay in main. */
export function getResumeDetail(ref: ResumeRef): ResumeDetail | null {
  const row = getDb()
    .prepare(
      `SELECT raw_text AS rawText,
              (SELECT COUNT(*) FROM chunks WHERE resume_id = resumes.id) AS passageCount
       FROM resumes
       WHERE id = ? AND content_hash = ?`
    )
    .get(ref.id, ref.recordKey) as ResumeDetail | undefined
  return row ?? null
}

/** Resolves a stored source path from a trusted database id, never renderer input. */
export function getResumeFilePath(ref: ResumeRef): string | null {
  const row = getDb()
    .prepare('SELECT file_path AS filePath FROM resumes WHERE id = ? AND content_hash = ?')
    .get(ref.id, ref.recordKey) as
    | { filePath: string }
    | undefined
  return row?.filePath || null
}

export function deleteResume(ref: ResumeRef): boolean {
  const d = getDb()
  const deleted = d.transaction(() => {
    const removed = d.prepare('DELETE FROM resumes WHERE id = ? AND content_hash = ?').run(ref.id, ref.recordKey).changes === 1
    if (removed) pruneRecruitingRecords(d)
    return removed
  })()
  if (deleted) {
    invalidateLibraryUsage()
    temporarySearch.prune(new Set(listResumes().map((resume) => resume.recordKey)))
  }
  return deleted
}

/** One transaction, so a bulk delete either fully happens or does not. */
export function deleteResumes(refs: ResumeRef[]): number {
  if (refs.length === 0) return 0
  const db = getDb()
  const exists = db.prepare(
    'SELECT 1 FROM resumes WHERE id = ? AND content_hash = ?'
  )
  const remove = db.prepare('DELETE FROM resumes WHERE id = ? AND content_hash = ?')
  const deleted = db.transaction(() => {
    if (refs.some((ref) => !exists.get(ref.id, ref.recordKey))) {
      throw new Error('The library changed before deletion. Refresh it and select again.')
    }
    refs.forEach((ref) => remove.run(ref.id, ref.recordKey))
    pruneRecruitingRecords(db)
    return refs.length
  })()
  if (deleted > 0) {
    invalidateLibraryUsage()
    temporarySearch.prune(new Set(listResumes().map((resume) => resume.recordKey)))
  }
  return deleted
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string | null }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string | null): void {
  getDb()
    .prepare(
      'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

/**
 * Removes every resume and every setting, leaving a valid empty database.
 *
 * Deliberately SQL rather than unlinking the file: better-sqlite3 holds the
 * handle open, and Windows refuses to delete an open file, so unlinking would
 * work on macOS and fail on Windows. Emptying the tables behaves identically on
 * both, and VACUUM returns the space so the file does not stay large.
 */
export function deleteAllData(): void {
  const d = getDb()
  // Chunks cascade from resumes; the FTS triggers keep the index in step.
  d.transaction(() => {
    d.prepare('DELETE FROM resumes').run()
    d.prepare('DELETE FROM settings').run()
    d.prepare('DELETE FROM recruiting_records').run()
  })()
  temporarySearch.clear()
  // VACUUM cannot run inside a transaction.
  d.exec('VACUUM')
  checkpointWalOrThrow('Qumaa could not finish securely deleting all library data.')
  libraryUsage = { resumeCount: 0, chunkCount: 0, rawTextChars: 0, chunkTextChars: 0 }
  // Older beta restore code retained full rollback databases indefinitely.
  // Wiping data must also remove those abandoned private copies.
  pruneStaleDatabaseArtifacts(dbPath())
}

export function stats(): DbStats {
  const d = getDb()
  const resumeCount = (d.prepare('SELECT COUNT(*) c FROM resumes').get() as { c: number }).c
  const chunkCount = (d.prepare('SELECT COUNT(*) c FROM chunks').get() as { c: number }).c
  let size = 0
  try {
    size = statSync(dbPath()).size
  } catch {
    /* file may not exist yet */
  }
  return { resumeCount, chunkCount, dbPath: dbPath(), dbSizeBytes: size }
}
