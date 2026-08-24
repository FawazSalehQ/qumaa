/** SQLite storage. Single file under userData; schema created on first open. */
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync, statSync } from 'node:fs'
import { EMBEDDING_DIM } from '../embed/protocol.js'
import { skillLabels } from '../ingest/skills.js'
import type {
  DbStats,
  EducationLevel,
  FileType,
  ResumeDetail,
  ResumePassage,
  ResumeSummary,
  SectionKind
} from '@shared/types.js'

export interface ResumeRow {
  id: number
  file_path: string
  file_name: string
  content_hash: string
  file_type: FileType
  imported_at: number
  raw_text: string
  name: string | null
  email: string | null
  phone: string | null
  location: string | null
  years_experience: number | null
  education_level: EducationLevel | null
  skills_json: string
  likely_scanned: number
}

export interface ChunkRow {
  id: number
  resume_id: number
  section: SectionKind
  ordinal: number
  text: string
  embedding: Buffer
}

let db: Database.Database | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS resumes (
  id            INTEGER PRIMARY KEY,
  file_path     TEXT    NOT NULL,
  file_name     TEXT    NOT NULL,
  content_hash  TEXT    NOT NULL UNIQUE,
  file_type     TEXT    NOT NULL,
  imported_at   INTEGER NOT NULL,
  raw_text      TEXT    NOT NULL,
  name             TEXT,
  email            TEXT,
  phone            TEXT,
  location         TEXT,
  years_experience REAL,
  education_level  TEXT,
  skills_json      TEXT NOT NULL DEFAULT '[]',
  likely_scanned   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chunks (
  id        INTEGER PRIMARY KEY,
  resume_id INTEGER NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  section   TEXT    NOT NULL,
  ordinal   INTEGER NOT NULL,
  text      TEXT    NOT NULL,
  embedding BLOB    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_resume ON chunks(resume_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- External-content FTS5 over resumes.raw_text, giving us bm25() for free.
CREATE VIRTUAL TABLE IF NOT EXISTS resumes_fts
  USING fts5(raw_text, content='resumes', content_rowid='id', tokenize='porter unicode61');

CREATE TRIGGER IF NOT EXISTS resumes_ai AFTER INSERT ON resumes BEGIN
  INSERT INTO resumes_fts(rowid, raw_text) VALUES (new.id, new.raw_text);
END;
CREATE TRIGGER IF NOT EXISTS resumes_ad AFTER DELETE ON resumes BEGIN
  INSERT INTO resumes_fts(resumes_fts, rowid, raw_text) VALUES ('delete', old.id, old.raw_text);
END;
CREATE TRIGGER IF NOT EXISTS resumes_au AFTER UPDATE ON resumes BEGIN
  INSERT INTO resumes_fts(resumes_fts, rowid, raw_text) VALUES ('delete', old.id, old.raw_text);
  INSERT INTO resumes_fts(rowid, raw_text) VALUES (new.id, new.raw_text);
END;
`

/**
 * Additive column migrations.
 *
 * The schema above uses CREATE TABLE IF NOT EXISTS, which does nothing to a
 * table that already exists, so new columns have to be added explicitly for
 * libraries created by an earlier version.
 */
function migrate(database: Database.Database): void {
  const columns = new Set(
    (database.prepare('PRAGMA table_info(resumes)').all() as Array<{ name: string }>).map(
      (c) => c.name
    )
  )

  // Mean of a resume's chunk vectors. Stored so near-duplicate detection reads
  // one vector per resume instead of every chunk in the library, which made a
  // bulk import quadratic.
  if (!columns.has('doc_vector')) {
    database.exec('ALTER TABLE resumes ADD COLUMN doc_vector BLOB')
  }
}

export function getDb(): Database.Database {
  if (db) return db
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  db = new Database(join(dir, 'cv_filter.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  migrate(db)
  return db
}

export function dbPath(): string {
  return join(app.getPath('userData'), 'cv_filter.db')
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
    fileName: r.file_name,
    filePath: r.file_path,
    fileType: r.file_type,
    importedAt: r.imported_at,
    name: r.name,
    email: r.email,
    phone: r.phone,
    location: r.location,
    yearsExperience: r.years_experience,
    educationLevel: r.education_level,
    // Stored as canonical ids; surfaced as display labels so the Library and the
    // Match cards name skills the same way ("CI/CD", not "cicd").
    skills: skillLabels(JSON.parse(r.skills_json) as string[]),
    likelyScanned: r.likely_scanned === 1
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
    .prepare('SELECT * FROM resumes ORDER BY imported_at DESC')
    .all() as ResumeRow[]
  return rows.map(rowToSummary)
}

/** Full record for the detail panel. Embeddings are deliberately not returned. */
export function getResumeDetail(id: number): ResumeDetail | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM resumes WHERE id = ?').get(id) as ResumeRow | undefined
  if (!row) return null

  const passages = db
    .prepare('SELECT section, ordinal, text FROM chunks WHERE resume_id = ? ORDER BY ordinal')
    .all(id) as ResumePassage[]

  return { summary: rowToSummary(row), rawText: row.raw_text, passages }
}

export function deleteResume(id: number): void {
  getDb().prepare('DELETE FROM resumes WHERE id = ?').run(id)
}

/** One transaction, so a bulk delete either fully happens or does not. */
export function deleteResumes(ids: number[]): number {
  if (ids.length === 0) return 0
  const db = getDb()
  const stmt = db.prepare('DELETE FROM resumes WHERE id = ?')
  db.transaction(() => ids.forEach((id) => stmt.run(id)))()
  return ids.length
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

export { EMBEDDING_DIM }
