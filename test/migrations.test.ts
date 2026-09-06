import { describe, expect, it } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  DATABASE_LIMITS,
  inferPublishedSchemaVersion,
  normalizeSchemaSql,
  QUMAA_APPLICATION_ID,
  type SchemaShape
} from '../src/main/db/migrations.js'

const BASE_RESUMES = [
  'id',
  'file_path',
  'file_name',
  'content_hash',
  'file_type',
  'imported_at',
  'raw_text',
  'name',
  'email',
  'phone',
  'location',
  'years_experience',
  'education_level',
  'skills_json',
  'likely_scanned'
]

const REQUIRED_OBJECTS = [
  'resumes',
  'chunks',
  'idx_chunks_resume',
  'settings',
  'resumes_fts',
  'resumes_ai',
  'resumes_ad',
  'resumes_au'
]

function shape(resumeColumns: string[], objects = REQUIRED_OBJECTS): SchemaShape {
  return {
    objects,
    tables: {
      resumes: resumeColumns,
      chunks: ['id', 'resume_id', 'section', 'ordinal', 'text', 'embedding'],
      settings: ['key', 'value']
    }
  }
}

describe('published database schema adoption', () => {
  it('uses a stable application id and current numbered version', () => {
    expect(QUMAA_APPLICATION_ID).toBe(0x51554d41)
    expect(CURRENT_SCHEMA_VERSION).toBe(4)
  })

  it('keeps the 3,000-resume capacity target inside fixed validation budgets', () => {
    expect(DATABASE_LIMITS.resumes).toBeGreaterThanOrEqual(3_000)
    expect(DATABASE_LIMITS.chunks).toBeGreaterThan(DATABASE_LIMITS.resumes)
    expect(DATABASE_LIMITS.chunksPerResume).toBe(512)
    expect(DATABASE_LIMITS.rawTextCharsPerResume).toBe(500_000)
  })

  it('recognises a genuinely empty new database', () => {
    expect(inferPublishedSchemaVersion({ objects: [], tables: {} })).toBe(0)
  })

  it('recognises every schema variant shipped before numbered migrations', () => {
    expect(inferPublishedSchemaVersion(shape(BASE_RESUMES))).toBe(1)
    expect(inferPublishedSchemaVersion(shape([...BASE_RESUMES, 'doc_vector']))).toBe(2)
    expect(
      inferPublishedSchemaVersion(shape([...BASE_RESUMES, 'doc_vector', 'skills_version']))
    ).toBe(3)

    // Fresh v0.3 libraries and upgraded v0.1 libraries had a different column
    // order; SQLite semantics are identical, so both must be adopted.
    expect(
      inferPublishedSchemaVersion(
        shape([...BASE_RESUMES.slice(0, -1), 'skills_version', 'likely_scanned', 'doc_vector'])
      )
    ).toBe(3)
  })

  it('rejects partial, foreign, and never-published variants', () => {
    expect(
      inferPublishedSchemaVersion(shape([...BASE_RESUMES, 'skills_version']))
    ).toBeNull()
    expect(
      inferPublishedSchemaVersion(shape([...BASE_RESUMES, 'doc_vector', 'unknown_column']))
    ).toBeNull()
    expect(
      inferPublishedSchemaVersion(shape(BASE_RESUMES, REQUIRED_OBJECTS.filter((n) => n !== 'resumes_au')))
    ).toBeNull()
    expect(inferPublishedSchemaVersion(shape(BASE_RESUMES, [...REQUIRED_OBJECTS, 'extra']))).toBeNull()
    expect(
      inferPublishedSchemaVersion({
        ...shape(BASE_RESUMES),
        tables: { ...shape(BASE_RESUMES).tables, chunks: ['id', 'payload'] }
      })
    ).toBeNull()
  })

  it('normalises harmless DDL formatting without hiding trigger changes', () => {
    const expected = `CREATE TRIGGER resumes_ai AFTER INSERT ON resumes BEGIN
      INSERT INTO resumes_fts(rowid, raw_text) VALUES (new.id, new.raw_text);
    END;`
    const historical = `create trigger IF NOT EXISTS resumes_ai
      after insert on resumes begin insert into resumes_fts ( rowid, raw_text )
      values ( new.id, new.raw_text ); end`
    const altered = `CREATE TRIGGER resumes_ai AFTER INSERT ON resumes BEGIN SELECT 1; END`

    expect(normalizeSchemaSql(historical)).toBe(normalizeSchemaSql(expected))
    expect(normalizeSchemaSql(altered)).not.toBe(normalizeSchemaSql(expected))
    // Text inside quotes is data, so canonicalisation must preserve it.
    expect(normalizeSchemaSql("SELECT 'porter  unicode61'")).not.toBe(
      normalizeSchemaSql("SELECT 'porter unicode61'")
    )
    expect(normalizeSchemaSql("SELECT 'if not exists'")).toContain("'if not exists'")
  })
})
