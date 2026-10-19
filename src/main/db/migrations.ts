/**
 * Numbered SQLite migrations and schema identity checks.
 *
 * Releases through v0.1.0-beta.1 created their schema idempotently but did not
 * set `user_version` or `application_id`.  `inferPublishedSchemaVersion` is the
 * deliberately narrow bridge from those databases into numbered migrations.
 * It recognises only the three schema shapes Qumaa actually shipped.
 */
import type Database from 'better-sqlite3'
import { EMBEDDING_DIM } from '../embed/protocol.js'
import { DATABASE_LIMITS } from './limits.js'
export { DATABASE_LIMITS } from './limits.js'
import { assertRecruitingData, RECRUITING_TABLE_SQL } from '../recruiting/storage.js'

/** ASCII "QUMA", stored in SQLite's standard application_id header field. */
export const QUMAA_APPLICATION_ID = 0x51554d41
export const CURRENT_SCHEMA_VERSION = 12

const BASE_RESUME_COLUMNS = [
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
] as const

const CHUNK_COLUMNS = ['id', 'resume_id', 'section', 'ordinal', 'text', 'embedding'] as const
const SETTINGS_COLUMNS = ['key', 'value'] as const

const SECTION_KINDS = new Set([
  'summary',
  'experience',
  'education',
  'skills',
  'projects',
  'other'
])
const VECTOR_BYTES = EMBEDDING_DIM * Float32Array.BYTES_PER_ELEMENT

/**
 * Hard storage limits applied before row bodies are inspected.
 *
 * The capacity benchmark tops out at 3,000 resumes. These ceilings leave room
 * above that target while keeping a hostile/corrupt backup from turning schema
 * validation into an unbounded allocation or multi-million-vector scan.
 */

/**
 * SQLite's length(TEXT) stops at the first U+0000 character. Pre-materialisation
 * budgets therefore measure the underlying UTF-8 bytes instead. Four bytes per
 * logical character preserves the documented limits for every Unicode scalar
 * while still putting a hard ceiling on hostile values.
 */
function textByteBudget(characterLimit: number): number {
  return characterLimit * 4
}

const REQUIRED_OBJECTS = [
  'resumes',
  'chunks',
  'idx_chunks_resume',
  'settings',
  'resumes_fts',
  'resumes_ai',
  'resumes_ad',
  'resumes_au'
] as const

const ALLOWED_OBJECTS = new Set<string>([
  ...REQUIRED_OBJECTS,
  // Stable FTS5 shadow tables created for the external-content index.
  'resumes_fts_data',
  'resumes_fts_idx',
  'resumes_fts_docsize',
  'resumes_fts_config',
  'sqlite_autoindex_resumes_1',
  'sqlite_autoindex_settings_1'
])

const EXPECTED_OBJECTS: Readonly<Record<string, { type: string; table: string }>> = {
  resumes: { type: 'table', table: 'resumes' },
  sqlite_autoindex_resumes_1: { type: 'index', table: 'resumes' },
  chunks: { type: 'table', table: 'chunks' },
  idx_chunks_resume: { type: 'index', table: 'chunks' },
  settings: { type: 'table', table: 'settings' },
  sqlite_autoindex_settings_1: { type: 'index', table: 'settings' },
  resumes_fts: { type: 'table', table: 'resumes_fts' },
  resumes_fts_data: { type: 'table', table: 'resumes_fts_data' },
  resumes_fts_idx: { type: 'table', table: 'resumes_fts_idx' },
  resumes_fts_docsize: { type: 'table', table: 'resumes_fts_docsize' },
  resumes_fts_config: { type: 'table', table: 'resumes_fts_config' },
  resumes_ai: { type: 'trigger', table: 'resumes' },
  resumes_ad: { type: 'trigger', table: 'resumes' },
  resumes_au: { type: 'trigger', table: 'resumes' }
}

interface ColumnMetadata {
  name: string
  type: string
  notNull: number
  defaultValue: string | null
  primaryKey: number
  hidden?: number
}

const BASE_RESUME_METADATA: readonly ColumnMetadata[] = [
  { name: 'id', type: 'INTEGER', notNull: 0, defaultValue: null, primaryKey: 1 },
  { name: 'file_path', type: 'TEXT', notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: 'file_name', type: 'TEXT', notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: 'content_hash', type: 'TEXT', notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: 'file_type', type: 'TEXT', notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: 'imported_at', type: 'INTEGER', notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: 'raw_text', type: 'TEXT', notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: 'name', type: 'TEXT', notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: 'email', type: 'TEXT', notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: 'phone', type: 'TEXT', notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: 'location', type: 'TEXT', notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: 'years_experience', type: 'REAL', notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: 'education_level', type: 'TEXT', notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: 'skills_json', type: 'TEXT', notNull: 1, defaultValue: "'[]'", primaryKey: 0 },
  { name: 'likely_scanned', type: 'INTEGER', notNull: 1, defaultValue: '0', primaryKey: 0 }
]

const DOC_VECTOR_METADATA: ColumnMetadata = {
  name: 'doc_vector',
  type: 'BLOB',
  notNull: 0,
  defaultValue: null,
  primaryKey: 0
}

const SKILLS_VERSION_METADATA: ColumnMetadata = {
  name: 'skills_version',
  type: 'TEXT',
  notNull: 1,
  defaultValue: "''",
  primaryKey: 0
}

const CHUNK_METADATA: readonly ColumnMetadata[] = [
  { name: 'id', type: 'INTEGER', notNull: 0, defaultValue: null, primaryKey: 1 },
  { name: 'resume_id', type: 'INTEGER', notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: 'section', type: 'TEXT', notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: 'ordinal', type: 'INTEGER', notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: 'text', type: 'TEXT', notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: 'embedding', type: 'BLOB', notNull: 1, defaultValue: null, primaryKey: 0 }
]

const SETTINGS_METADATA: readonly ColumnMetadata[] = [
  { name: 'key', type: 'TEXT', notNull: 0, defaultValue: null, primaryKey: 1 },
  { name: 'value', type: 'TEXT', notNull: 0, defaultValue: null, primaryKey: 0 }
]

const RECRUITING_METADATA: readonly ColumnMetadata[] = [
  { name: 'kind', type: 'TEXT', notNull: 1, defaultValue: null, primaryKey: 1 },
  { name: 'id', type: 'TEXT', notNull: 1, defaultValue: null, primaryKey: 2 },
  { name: 'data', type: 'TEXT', notNull: 1, defaultValue: null, primaryKey: 0 }
]

const RESUMES_V1_SQL = `CREATE TABLE resumes (
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
)`

const CHUNKS_SQL = `CREATE TABLE chunks (
  id        INTEGER PRIMARY KEY,
  resume_id INTEGER NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  section   TEXT    NOT NULL,
  ordinal   INTEGER NOT NULL,
  text      TEXT    NOT NULL,
  embedding BLOB    NOT NULL
)`
const CHUNKS_INDEX_SQL = 'CREATE INDEX idx_chunks_resume ON chunks(resume_id)'

const SETTINGS_SQL = `CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
)`

/** The exact base schema shipped in Qumaa v0.1.0. */
export const PUBLISHED_SCHEMA_V1_SQL = `
${RESUMES_V1_SQL};
${CHUNKS_SQL};
${CHUNKS_INDEX_SQL};
${SETTINGS_SQL};

CREATE VIRTUAL TABLE resumes_fts
  USING fts5(raw_text, content='resumes', content_rowid='id', tokenize='porter unicode61');

CREATE TRIGGER resumes_ai AFTER INSERT ON resumes BEGIN
  INSERT INTO resumes_fts(rowid, raw_text) VALUES (new.id, new.raw_text);
END;
CREATE TRIGGER resumes_ad AFTER DELETE ON resumes BEGIN
  INSERT INTO resumes_fts(resumes_fts, rowid, raw_text) VALUES ('delete', old.id, old.raw_text);
END;
CREATE TRIGGER resumes_au AFTER UPDATE ON resumes BEGIN
  INSERT INTO resumes_fts(resumes_fts, rowid, raw_text) VALUES ('delete', old.id, old.raw_text);
  INSERT INTO resumes_fts(rowid, raw_text) VALUES (new.id, new.raw_text);
END;
`

/**
 * Only our own DDL forms may reach integrity checking or migration writes.
 * Column/index pragmas do not expose added CHECK expressions, including ones
 * on FTS shadow tables that SQLite evaluates during quick_check.
 */
const EXPECTED_SCHEMA_SQL: Readonly<Record<string, string | null>> = {
  chunks: CHUNKS_SQL,
  idx_chunks_resume: CHUNKS_INDEX_SQL,
  settings: SETTINGS_SQL,
  sqlite_autoindex_resumes_1: null,
  sqlite_autoindex_settings_1: null,
  resumes_fts_data: "CREATE TABLE 'resumes_fts_data'(id INTEGER PRIMARY KEY, block BLOB)",
  resumes_fts_idx: "CREATE TABLE 'resumes_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID",
  resumes_fts_docsize: "CREATE TABLE 'resumes_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)",
  resumes_fts_config: "CREATE TABLE 'resumes_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID",
  resumes_fts: `CREATE VIRTUAL TABLE resumes_fts
    USING fts5(raw_text, content='resumes', content_rowid='id', tokenize='porter unicode61')`,
  resumes_ai: `CREATE TRIGGER resumes_ai AFTER INSERT ON resumes BEGIN
    INSERT INTO resumes_fts(rowid, raw_text) VALUES (new.id, new.raw_text);
  END`,
  resumes_ad: `CREATE TRIGGER resumes_ad AFTER DELETE ON resumes BEGIN
    INSERT INTO resumes_fts(resumes_fts, rowid, raw_text) VALUES ('delete', old.id, old.raw_text);
  END`,
  resumes_au: `CREATE TRIGGER resumes_au AFTER UPDATE ON resumes BEGIN
    INSERT INTO resumes_fts(resumes_fts, rowid, raw_text) VALUES ('delete', old.id, old.raw_text);
    INSERT INTO resumes_fts(rowid, raw_text) VALUES (new.id, new.raw_text);
  END`
}

function expectedResumeSql(version: number): readonly string[] {
  if (version === 1) return [RESUMES_V1_SQL]
  const v2 = RESUMES_V1_SQL.replace(/\)\s*$/, ', doc_vector BLOB)')
  if (version === 2) return [v2]
  return [
    v2.replace(/\)\s*$/, ", skills_version TEXT NOT NULL DEFAULT '')"),
    // Fresh published v3 libraries placed skills_version before likely_scanned
    // and then added doc_vector. Preserve that genuine historical variant.
    v2.replace('likely_scanned   INTEGER', "skills_version TEXT NOT NULL DEFAULT '', likely_scanned   INTEGER")
  ]
}

/**
 * Canonicalises formatting while preserving quoted text. SQLite keeps the
 * original CREATE statement in sqlite_schema, including harmless whitespace
 * and the historical IF NOT EXISTS clauses.
 */
export function normalizeSchemaSql(sql: string): string {
  let result = ''
  let quote: "'" | '"' | '`' | ']' | null = null

  for (let index = 0; index < sql.length; index++) {
    const character = sql[index]
    if (quote !== null) {
      result += character
      const closesQuote = quote === ']' ? character === ']' : character === quote
      if (closesQuote) {
        // SQL escapes matching quote characters by doubling them.
        if (quote !== ']' && sql[index + 1] === character) {
          result += sql[++index]
        } else {
          quote = null
        }
      }
      continue
    }

    const optionalClause =
      (index === 0 || !/[a-z0-9_]/i.test(sql[index - 1])) &&
      /^if\s+not\s+exists\b/i.exec(sql.slice(index))
    if (optionalClause) {
      index += optionalClause[0].length - 1
      continue
    }
    if (/\s/.test(character)) continue
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      result += character
    } else if (character === '[') {
      quote = ']'
      result += character
    } else {
      result += character.toLowerCase()
    }
  }

  return result.endsWith(';') ? result.slice(0, -1) : result
}

export interface SchemaShape {
  /** Every SQLite object name, including the known implicit indexes. */
  objects: readonly string[]
  /** Columns for Qumaa's ordinary tables. */
  tables: Readonly<Record<string, readonly string[]>>
}

function sameMembers(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  if (!actual || actual.length !== expected.length) return false
  const members = new Set(actual)
  return expected.every((name) => members.has(name))
}

/**
 * Returns the shipped schema version represented by a legacy user_version=0
 * database, 0 for a genuinely empty database, or null for an unknown shape.
 */
export function inferPublishedSchemaVersion(shape: SchemaShape): 0 | 1 | 2 | 3 | null {
  if (shape.objects.length === 0) return 0

  const objects = new Set(shape.objects)
  if (!REQUIRED_OBJECTS.every((name) => objects.has(name))) return null
  if (shape.objects.some((name) => !ALLOWED_OBJECTS.has(name))) return null
  if (!sameMembers(shape.tables.chunks, CHUNK_COLUMNS)) return null
  if (!sameMembers(shape.tables.settings, SETTINGS_COLUMNS)) return null

  const resumeColumns = shape.tables.resumes
  if (!resumeColumns) return null
  const allowedColumns = new Set([...BASE_RESUME_COLUMNS, 'doc_vector', 'skills_version'])
  if (resumeColumns.some((name) => !allowedColumns.has(name))) return null
  if (!BASE_RESUME_COLUMNS.every((name) => resumeColumns.includes(name))) return null

  const hasDocumentVector = resumeColumns.includes('doc_vector')
  const hasSkillsVersion = resumeColumns.includes('skills_version')
  if (hasSkillsVersion && !hasDocumentVector) return null
  if (hasSkillsVersion) return 3
  if (hasDocumentVector) return 2
  return 1
}

function tableColumns(database: Database.Database, table: string): string[] {
  // Callers only pass the fixed table names above; no user-controlled SQL is interpolated.
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    ({ name }) => name
  )
}

const SCHEMA_METADATA_LIMITS = Object.freeze({
  objects: 32,
  nameBytes: 128 * 4,
  typeBytes: 32 * 4,
  tableNameBytes: 128 * 4,
  sqlBytesPerObject: 64 * 1024 * 4,
  totalSqlBytes: 256 * 1024 * 4
})

function assertSchemaMetadataBudget(database: Database.Database): void {
  // The BLOB lengths are a cheap size gate before SQLite scans for NUL and
  // before schema names or DDL are returned to JavaScript.
  const metadata = database
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(MAX(length(CAST(name AS BLOB))), 0) AS maxNameBytes,
              COALESCE(MAX(length(CAST(type AS BLOB))), 0) AS maxTypeBytes,
              COALESCE(MAX(length(CAST(tbl_name AS BLOB))), 0) AS maxTableNameBytes,
              COALESCE(MAX(length(CAST(sql AS BLOB))), 0) AS maxSqlBytes,
              COALESCE(SUM(length(CAST(sql AS BLOB))), 0) AS totalSqlBytes
       FROM sqlite_schema`
    )
    .get() as {
    count: number
    maxNameBytes: number
    maxTypeBytes: number
    maxTableNameBytes: number
    maxSqlBytes: number
    totalSqlBytes: number
  }

  if (
    metadata.count > SCHEMA_METADATA_LIMITS.objects ||
    metadata.maxNameBytes > SCHEMA_METADATA_LIMITS.nameBytes ||
    metadata.maxTypeBytes > SCHEMA_METADATA_LIMITS.typeBytes ||
    metadata.maxTableNameBytes > SCHEMA_METADATA_LIMITS.tableNameBytes ||
    metadata.maxSqlBytes > SCHEMA_METADATA_LIMITS.sqlBytesPerObject ||
    metadata.totalSqlBytes > SCHEMA_METADATA_LIMITS.totalSqlBytes
  ) {
    throw new Error('The database schema metadata exceeds Qumaa safety limits.')
  }

  // Reject NUL explicitly after the byte gate so later schema comparisons can
  // never observe SQLite's truncated TEXT semantics.
  const embeddedNul = database
    .prepare(
      `SELECT EXISTS(
         SELECT 1
         FROM sqlite_schema
         WHERE instr(name, char(0)) > 0
            OR instr(type, char(0)) > 0
            OR instr(tbl_name, char(0)) > 0
            OR instr(sql, char(0)) > 0
         LIMIT 1
       ) AS found`
    )
    .get() as { found: number }
  if (embeddedNul.found !== 0) {
    throw new Error('The database schema metadata contains embedded NUL text.')
  }
}

export function inspectSchema(database: Database.Database): SchemaShape {
  assertSchemaMetadataBudget(database)
  const rows =
    database
      .prepare('SELECT name FROM sqlite_schema')
      .all() as Array<{ name: string }>
  const objects = rows.map(({ name }) => name)

  return {
    objects,
    tables: {
      resumes: tableColumns(database, 'resumes'),
      chunks: tableColumns(database, 'chunks'),
      settings: tableColumns(database, 'settings')
    }
  }
}

interface SchemaObjectRow {
  name: string
  type: string
  tbl_name: string
  sql: string | null
}

interface PragmaColumnRow {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
  hidden: number
}

function schemaMismatch(version: number, detail: string): never {
  throw new Error(`The database schema does not match Qumaa schema version ${version}: ${detail}.`)
}

function tableMetadata(database: Database.Database, table: string): ColumnMetadata[] {
  // All names passed here are constants owned by this module.
  const rows = database.prepare(`PRAGMA table_xinfo(${table})`).all() as PragmaColumnRow[]
  return rows.map((column) => ({
    name: column.name,
    type: column.type,
    notNull: column.notnull,
    defaultValue: column.dflt_value,
    primaryKey: column.pk,
    hidden: column.hidden
  }))
}

function columnSignature(column: ColumnMetadata): string {
  return JSON.stringify([
    column.name,
    column.type.toUpperCase(),
    column.notNull,
    column.defaultValue,
    column.primaryKey,
    column.hidden ?? 0
  ])
}

function metadataMatches(
  actual: readonly ColumnMetadata[],
  expected: readonly ColumnMetadata[]
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((column, index) => columnSignature(column) === columnSignature(expected[index]))
  )
}

function expectedResumeMetadata(version: number): readonly (readonly ColumnMetadata[])[] {
  if (version === 1) return [BASE_RESUME_METADATA]
  if (version === 2) return [[...BASE_RESUME_METADATA, DOC_VECTOR_METADATA]]
  if (version >= 3) {
    return [
      // Libraries upgraded through the additive v1 -> v2 -> v3 path.
      [...BASE_RESUME_METADATA, DOC_VECTOR_METADATA, SKILLS_VERSION_METADATA],
      // Libraries first created by the previously published v0.3 schema.
      [
        ...BASE_RESUME_METADATA.slice(0, -1),
        SKILLS_VERSION_METADATA,
        BASE_RESUME_METADATA[BASE_RESUME_METADATA.length - 1],
        DOC_VECTOR_METADATA
      ]
    ]
  }
  return []
}

function assertObjects(database: Database.Database, version: number): void {
  const rows = database
    .prepare(
      'SELECT name, type, tbl_name, sql FROM sqlite_schema ORDER BY name'
    )
    .all() as SchemaObjectRow[]
  const expectedObjects = version >= 4
    ? {
        ...EXPECTED_OBJECTS,
        recruiting_records: { type: 'table', table: 'recruiting_records' },
        sqlite_autoindex_recruiting_records_1: { type: 'index', table: 'recruiting_records' }
      }
    : EXPECTED_OBJECTS
  const expectedNames = Object.keys(expectedObjects).sort()
  if (
    rows.length !== expectedNames.length ||
    rows.some((row, index) => row.name !== expectedNames[index])
  ) {
    schemaMismatch(version, 'the SQLite object set is altered')
  }

  for (const row of rows) {
    const expected = expectedObjects[row.name]
    if (row.type !== expected.type || row.tbl_name !== expected.table) {
      schemaMismatch(version, `object ${row.name} has the wrong type or owner`)
    }

    const expectedSql = row.name === 'resumes'
      ? expectedResumeSql(version)
      : row.name === 'recruiting_records'
        ? [RECRUITING_TABLE_SQL]
        : row.name === 'sqlite_autoindex_recruiting_records_1'
          ? [null]
          : [EXPECTED_SCHEMA_SQL[row.name]]
    if (!expectedSql.some((sql) =>
      sql === null ? row.sql === null :
        sql !== undefined && row.sql !== null && normalizeSchemaSql(row.sql) === normalizeSchemaSql(sql)
    )) {
      schemaMismatch(version, `object ${row.name} has altered SQL`)
    }
  }
}

function assertTableMetadata(database: Database.Database, version: number): void {
  const resumeMetadata = tableMetadata(database, 'resumes')
  if (!expectedResumeMetadata(version).some((expected) => metadataMatches(resumeMetadata, expected))) {
    schemaMismatch(version, 'table resumes has altered column metadata')
  }
  if (!metadataMatches(tableMetadata(database, 'chunks'), CHUNK_METADATA)) {
    schemaMismatch(version, 'table chunks has altered column metadata')
  }
  if (!metadataMatches(tableMetadata(database, 'settings'), SETTINGS_METADATA)) {
    schemaMismatch(version, 'table settings has altered column metadata')
  }
  if (version >= 4 && !metadataMatches(tableMetadata(database, 'recruiting_records'), RECRUITING_METADATA)) {
    schemaMismatch(version, 'table recruiting_records has altered column metadata')
  }

  const expectedFtsMetadata: readonly ColumnMetadata[] = [
    { name: 'raw_text', type: '', notNull: 0, defaultValue: null, primaryKey: 0, hidden: 0 },
    { name: 'resumes_fts', type: '', notNull: 0, defaultValue: null, primaryKey: 0, hidden: 1 },
    { name: 'rank', type: '', notNull: 0, defaultValue: null, primaryKey: 0, hidden: 1 }
  ]
  if (!metadataMatches(tableMetadata(database, 'resumes_fts'), expectedFtsMetadata)) {
    schemaMismatch(version, 'the FTS5 table metadata is altered')
  }
}

interface IndexListRow {
  name: string
  unique: number
  origin: string
  partial: number
}

interface IndexColumnRow {
  seqno: number
  cid: number
  name: string | null
  desc: number
  coll: string
  key: number
}

interface ExpectedIndex {
  name: string
  unique: number
  origin: string
  partial: number
  columns: readonly [number, number, string | null, number, string, number][]
}

const EXPECTED_INDEXES: Readonly<Record<string, readonly ExpectedIndex[]>> = {
  resumes: [
    {
      name: 'sqlite_autoindex_resumes_1',
      unique: 1,
      origin: 'u',
      partial: 0,
      columns: [
        [0, 3, 'content_hash', 0, 'BINARY', 1],
        [1, -1, null, 0, 'BINARY', 0]
      ]
    }
  ],
  chunks: [
    {
      name: 'idx_chunks_resume',
      unique: 0,
      origin: 'c',
      partial: 0,
      columns: [
        [0, 1, 'resume_id', 0, 'BINARY', 1],
        [1, -1, null, 0, 'BINARY', 0]
      ]
    }
  ],
  settings: [
    {
      name: 'sqlite_autoindex_settings_1',
      unique: 1,
      origin: 'pk',
      partial: 0,
      columns: [
        [0, 0, 'key', 0, 'BINARY', 1],
        [1, -1, null, 0, 'BINARY', 0]
      ]
    }
  ]
}

const RECRUITING_INDEXES: readonly ExpectedIndex[] = [{
  name: 'sqlite_autoindex_recruiting_records_1', unique: 1, origin: 'pk', partial: 0,
  columns: [[0, 0, 'kind', 0, 'BINARY', 1], [1, 1, 'id', 0, 'BINARY', 1], [2, -1, null, 0, 'BINARY', 0]]
}]

function assertIndexes(database: Database.Database, version: number): void {
  const indexes = version >= 4 ? { ...EXPECTED_INDEXES, recruiting_records: RECRUITING_INDEXES } : EXPECTED_INDEXES
  for (const [table, expectedIndexes] of Object.entries(indexes)) {
    const actual = database.prepare(`PRAGMA index_list(${table})`).all() as IndexListRow[]
    if (actual.length !== expectedIndexes.length) {
      schemaMismatch(version, `table ${table} has an altered index set`)
    }
    for (const expected of expectedIndexes) {
      const index = actual.find(({ name }) => name === expected.name)
      if (
        !index ||
        index.unique !== expected.unique ||
        index.origin !== expected.origin ||
        index.partial !== expected.partial
      ) {
        schemaMismatch(version, `index ${expected.name} has altered metadata`)
      }
      const columns = database.prepare(`PRAGMA index_xinfo(${expected.name})`).all() as IndexColumnRow[]
      const signatures = columns.map(
        ({ seqno, cid, name, desc, coll, key }) => [seqno, cid, name, desc, coll, key] as const
      )
      if (JSON.stringify(signatures) !== JSON.stringify(expected.columns)) {
        schemaMismatch(version, `index ${expected.name} has altered columns or collation`)
      }
    }
  }
}

interface ForeignKeyRow {
  id: number
  seq: number
  table: string
  from: string
  to: string
  on_update: string
  on_delete: string
  match: string
}

function assertForeignKeys(database: Database.Database, version: number): void {
  for (const table of version >= 4 ? ['resumes', 'settings', 'recruiting_records'] : ['resumes', 'settings']) {
    if ((database.prepare(`PRAGMA foreign_key_list(${table})`).all() as unknown[]).length !== 0) {
      schemaMismatch(version, `table ${table} has unexpected foreign keys`)
    }
  }

  const actual = database.prepare('PRAGMA foreign_key_list(chunks)').all() as ForeignKeyRow[]
  const expected: ForeignKeyRow[] = [
    {
      id: 0,
      seq: 0,
      table: 'resumes',
      from: 'resume_id',
      to: 'id',
      on_update: 'NO ACTION',
      on_delete: 'CASCADE',
      match: 'NONE'
    }
  ]
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    schemaMismatch(version, 'the chunks foreign key is altered')
  }
}

interface ResumeAggregate {
  count: number
  totalRawTextBytes: number
  maxRawTextBytes: number
  maxFilePathBytes: number
  maxFileNameBytes: number
  maxContentHashBytes: number
  maxFileTypeBytes: number
  maxNameBytes: number
  maxEmailBytes: number
  maxPhoneBytes: number
  maxLocationBytes: number
  maxEducationBytes: number
  maxSkillsJsonBytes: number
  maxSkillsVersionBytes: number
}

interface ChunkAggregate {
  count: number
  totalTextBytes: number
  maxTextBytes: number
  maxSectionBytes: number
  maxEmbeddingBytes: number
}

interface SettingsAggregate {
  count: number
  maxKeyBytes: number
  maxValueBytes: number
}

function assertNoEmbeddedNul(database: Database.Database, version: number): void {
  const skillsVersionPredicate = version >= 3 ? ' OR instr(skills_version, char(0)) > 0' : ''
  // Keep every attacker-controlled text value inside SQLite until this scalar
  // preflight passes. The byte aggregate has already bounded the scan, and row
  // iteration has not started yet.
  const row = database
    .prepare(
      `SELECT
         EXISTS(
           SELECT 1 FROM resumes
           WHERE instr(file_path, char(0)) > 0
              OR instr(file_name, char(0)) > 0
              OR instr(content_hash, char(0)) > 0
              OR instr(file_type, char(0)) > 0
              OR instr(raw_text, char(0)) > 0
              OR instr(name, char(0)) > 0
              OR instr(email, char(0)) > 0
              OR instr(phone, char(0)) > 0
              OR instr(location, char(0)) > 0
              OR instr(education_level, char(0)) > 0
              OR instr(skills_json, char(0)) > 0
              ${skillsVersionPredicate}
           LIMIT 1
         ) OR EXISTS(
           SELECT 1 FROM chunks
           WHERE instr(section, char(0)) > 0
              OR instr(text, char(0)) > 0
           LIMIT 1
         ) OR EXISTS(
           SELECT 1 FROM settings
           WHERE instr(key, char(0)) > 0
              OR instr(value, char(0)) > 0
           LIMIT 1
         ) AS found`
    )
    .get() as { found: number }

  if (row.found !== 0) {
    schemaMismatch(version, 'stored text contains an embedded NUL character')
  }
}

function assertAggregateLimits(database: Database.Database, version: number): void {
  const skillsVersionAggregate =
    version >= 3
      ? ', COALESCE(MAX(length(CAST(skills_version AS BLOB))), 0) AS maxSkillsVersionBytes'
      : ', 0 AS maxSkillsVersionBytes'
  const resumes = database
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(length(CAST(raw_text AS BLOB))), 0) AS totalRawTextBytes,
              COALESCE(MAX(length(CAST(raw_text AS BLOB))), 0) AS maxRawTextBytes,
              COALESCE(MAX(length(CAST(file_path AS BLOB))), 0) AS maxFilePathBytes,
              COALESCE(MAX(length(CAST(file_name AS BLOB))), 0) AS maxFileNameBytes,
              COALESCE(MAX(length(CAST(content_hash AS BLOB))), 0) AS maxContentHashBytes,
              COALESCE(MAX(length(CAST(file_type AS BLOB))), 0) AS maxFileTypeBytes,
              COALESCE(MAX(length(CAST(name AS BLOB))), 0) AS maxNameBytes,
              COALESCE(MAX(length(CAST(email AS BLOB))), 0) AS maxEmailBytes,
              COALESCE(MAX(length(CAST(phone AS BLOB))), 0) AS maxPhoneBytes,
              COALESCE(MAX(length(CAST(location AS BLOB))), 0) AS maxLocationBytes,
              COALESCE(MAX(length(CAST(education_level AS BLOB))), 0) AS maxEducationBytes,
              COALESCE(MAX(length(CAST(skills_json AS BLOB))), 0) AS maxSkillsJsonBytes
              ${skillsVersionAggregate}
       FROM resumes`
    )
    .get() as ResumeAggregate

  if (resumes.count > DATABASE_LIMITS.resumes) {
    schemaMismatch(version, `the library exceeds ${DATABASE_LIMITS.resumes} resumes`)
  }
  if (
    resumes.maxRawTextBytes > textByteBudget(DATABASE_LIMITS.rawTextCharsPerResume) ||
    resumes.totalRawTextBytes > textByteBudget(DATABASE_LIMITS.totalRawTextChars)
  ) {
    schemaMismatch(version, 'stored resume text exceeds the safety limit')
  }
  if (
    resumes.maxFilePathBytes > textByteBudget(DATABASE_LIMITS.filePathChars) ||
    resumes.maxFileNameBytes > textByteBudget(DATABASE_LIMITS.labelChars) ||
    resumes.maxNameBytes > textByteBudget(DATABASE_LIMITS.labelChars) ||
    resumes.maxEmailBytes > textByteBudget(DATABASE_LIMITS.emailChars) ||
    resumes.maxPhoneBytes > textByteBudget(DATABASE_LIMITS.phoneChars) ||
    resumes.maxLocationBytes > textByteBudget(DATABASE_LIMITS.labelChars) ||
    resumes.maxContentHashBytes > textByteBudget(64) ||
    resumes.maxFileTypeBytes > textByteBudget(16) ||
    resumes.maxEducationBytes > textByteBudget(16) ||
    resumes.maxSkillsJsonBytes > textByteBudget(DATABASE_LIMITS.skillsJsonChars) ||
    resumes.maxSkillsVersionBytes > textByteBudget(DATABASE_LIMITS.skillsVersionChars)
  ) {
    schemaMismatch(version, 'a stored resume field exceeds its safety limit')
  }

  const chunks = database
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(length(CAST(text AS BLOB))), 0) AS totalTextBytes,
              COALESCE(MAX(length(CAST(text AS BLOB))), 0) AS maxTextBytes,
              COALESCE(MAX(length(CAST(section AS BLOB))), 0) AS maxSectionBytes,
              COALESCE(MAX(length(embedding)), 0) AS maxEmbeddingBytes
       FROM chunks`
    )
    .get() as ChunkAggregate
  if (chunks.count > DATABASE_LIMITS.chunks) {
    schemaMismatch(version, `the library exceeds ${DATABASE_LIMITS.chunks} searchable passages`)
  }
  if (
    chunks.maxTextBytes > textByteBudget(DATABASE_LIMITS.chunkTextChars) ||
    chunks.totalTextBytes > textByteBudget(DATABASE_LIMITS.totalChunkTextChars) ||
    chunks.maxSectionBytes > textByteBudget(32) ||
    chunks.maxEmbeddingBytes > VECTOR_BYTES
  ) {
    schemaMismatch(version, 'stored passage data exceeds the safety limit')
  }

  const oversizedResume = database
    .prepare(
      `SELECT resume_id AS resumeId, COUNT(*) AS count
       FROM chunks
       GROUP BY resume_id
       HAVING COUNT(*) > ?
       LIMIT 1`
    )
    .get(DATABASE_LIMITS.chunksPerResume) as { resumeId: number; count: number } | undefined
  if (oversizedResume) {
    schemaMismatch(
      version,
      `resume ${oversizedResume.resumeId} exceeds ${DATABASE_LIMITS.chunksPerResume} searchable passages`
    )
  }

  const settings = database
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(MAX(length(CAST(key AS BLOB))), 0) AS maxKeyBytes,
              COALESCE(MAX(length(CAST(value AS BLOB))), 0) AS maxValueBytes
       FROM settings`
    )
    .get() as SettingsAggregate
  if (settings.count > DATABASE_LIMITS.settings) {
    schemaMismatch(version, `the database exceeds ${DATABASE_LIMITS.settings} settings`)
  }
  if (
    settings.maxKeyBytes > textByteBudget(DATABASE_LIMITS.settingKeyChars) ||
    settings.maxValueBytes > textByteBudget(DATABASE_LIMITS.settingValueChars)
  ) {
    schemaMismatch(version, 'a stored setting exceeds the safety limit')
  }
}

const CONTENT_HASH = /^[a-f0-9]{64}$/
const FILE_TYPES = new Set(['pdf', 'docx', 'md', 'pasted'])
const EDUCATION_LEVELS = new Set(['phd', 'masters', 'bachelors', 'associate'])

function validRequiredText(value: unknown, valueType: string, max: number): value is string {
  return (
    valueType === 'text' &&
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !value.includes('\0')
  )
}

function validOptionalText(value: unknown, valueType: string, max: number): boolean {
  return (
    (valueType === 'null' && value === null) ||
    validRequiredText(value, valueType, max)
  )
}

interface StoredResumeRow {
  id: number
  filePath: unknown
  filePathType: string
  fileName: unknown
  fileNameType: string
  contentHash: unknown
  contentHashType: string
  fileType: unknown
  fileTypeType: string
  importedAt: unknown
  importedAtType: string
  rawTextType: string
  rawTextChars: number
  name: unknown
  nameType: string
  email: unknown
  emailType: string
  phone: unknown
  phoneType: string
  location: unknown
  locationType: string
  yearsExperience: unknown
  yearsExperienceType: string
  educationLevel: unknown
  educationLevelType: string
  skillsJson: unknown
  skillsType: string
  likelyScanned: unknown
  likelyScannedType: string
  skillsVersion?: unknown
  skillsVersionType?: string
  documentVectorType?: string
  documentVectorBytes?: number | null
}

function assertResumeRows(database: Database.Database, version: number): void {
  const skillsVersionProjection =
    version >= 3
      ? ', skills_version AS skillsVersion, typeof(skills_version) AS skillsVersionType'
      : ''
  const documentVectorProjection =
    version >= 2
      ? ', typeof(doc_vector) AS documentVectorType, length(doc_vector) AS documentVectorBytes'
      : ''
  const rows = database
    .prepare(
      `SELECT id,
              file_path AS filePath, typeof(file_path) AS filePathType,
              file_name AS fileName, typeof(file_name) AS fileNameType,
              content_hash AS contentHash, typeof(content_hash) AS contentHashType,
              file_type AS fileType, typeof(file_type) AS fileTypeType,
              imported_at AS importedAt, typeof(imported_at) AS importedAtType,
              typeof(raw_text) AS rawTextType, length(raw_text) AS rawTextChars,
              name, typeof(name) AS nameType,
              email, typeof(email) AS emailType,
              phone, typeof(phone) AS phoneType,
              location, typeof(location) AS locationType,
              years_experience AS yearsExperience,
              typeof(years_experience) AS yearsExperienceType,
              education_level AS educationLevel,
              typeof(education_level) AS educationLevelType,
              skills_json AS skillsJson, typeof(skills_json) AS skillsType,
              likely_scanned AS likelyScanned, typeof(likely_scanned) AS likelyScannedType
              ${skillsVersionProjection}${documentVectorProjection}
       FROM resumes
       ORDER BY id`
    )
    .iterate() as IterableIterator<StoredResumeRow>

  for (const resume of rows) {
    if (!Number.isSafeInteger(resume.id) || resume.id <= 0) {
      schemaMismatch(version, 'a resume has an invalid id')
    }
    if (
      resume.filePathType !== 'text' ||
      typeof resume.filePath !== 'string' ||
      resume.filePath.length > DATABASE_LIMITS.filePathChars ||
      resume.filePath.includes('\0') ||
      !validRequiredText(
        resume.fileName,
        resume.fileNameType,
        DATABASE_LIMITS.labelChars
      ) ||
      resume.contentHashType !== 'text' ||
      typeof resume.contentHash !== 'string' ||
      !CONTENT_HASH.test(resume.contentHash) ||
      resume.fileTypeType !== 'text' ||
      typeof resume.fileType !== 'string' ||
      !FILE_TYPES.has(resume.fileType) ||
      resume.importedAtType !== 'integer' ||
      !Number.isSafeInteger(resume.importedAt) ||
      Number(resume.importedAt) < 0 ||
      resume.rawTextType !== 'text' ||
      !Number.isInteger(resume.rawTextChars) ||
      resume.rawTextChars < 1 ||
      resume.rawTextChars > DATABASE_LIMITS.rawTextCharsPerResume ||
      !validOptionalText(resume.name, resume.nameType, DATABASE_LIMITS.labelChars) ||
      !validOptionalText(resume.email, resume.emailType, DATABASE_LIMITS.emailChars) ||
      !validOptionalText(resume.phone, resume.phoneType, DATABASE_LIMITS.phoneChars) ||
      !validOptionalText(resume.location, resume.locationType, DATABASE_LIMITS.labelChars)
    ) {
      schemaMismatch(version, `resume ${resume.id} has an invalid stored field`)
    }

    if (
      resume.yearsExperienceType !== 'null' &&
      !(
        (resume.yearsExperienceType === 'integer' || resume.yearsExperienceType === 'real') &&
        typeof resume.yearsExperience === 'number' &&
        Number.isFinite(resume.yearsExperience) &&
        resume.yearsExperience >= 0 &&
        resume.yearsExperience <= DATABASE_LIMITS.yearsExperience
      )
    ) {
      schemaMismatch(version, `resume ${resume.id} has invalid years of experience`)
    }
    if (
      resume.educationLevelType !== 'null' &&
      !(
        resume.educationLevelType === 'text' &&
        typeof resume.educationLevel === 'string' &&
        EDUCATION_LEVELS.has(resume.educationLevel)
      )
    ) {
      schemaMismatch(version, `resume ${resume.id} has an invalid education level`)
    }
    if (
      resume.likelyScannedType !== 'integer' ||
      (resume.likelyScanned !== 0 && resume.likelyScanned !== 1)
    ) {
      schemaMismatch(version, `resume ${resume.id} has an invalid scan marker`)
    }
    if (
      version >= 3 &&
      !(
        resume.skillsVersionType === 'text' &&
        typeof resume.skillsVersion === 'string' &&
        resume.skillsVersion.length <= DATABASE_LIMITS.skillsVersionChars &&
        !/[\u0000-\u001f\u007f]/.test(resume.skillsVersion)
      )
    ) {
      schemaMismatch(version, `resume ${resume.id} has an invalid skills version`)
    }

    let skills: unknown
    try {
      skills = typeof resume.skillsJson === 'string' ? JSON.parse(resume.skillsJson) : null
    } catch {
      skills = null
    }
    if (
      resume.skillsType !== 'text' ||
      !Array.isArray(skills) ||
      skills.length > DATABASE_LIMITS.skills ||
      !skills.every(
        (skill) =>
          typeof skill === 'string' &&
          skill.length > 0 &&
          skill.length <= DATABASE_LIMITS.skillChars &&
          !/[\u0000-\u001f\u007f]/.test(skill)
      ) ||
      new Set(skills).size !== skills.length
    ) {
      schemaMismatch(version, `resume ${resume.id} has invalid skills JSON`)
    }

    if (
      version >= 2 &&
      resume.documentVectorType !== 'null' &&
      (resume.documentVectorType !== 'blob' || resume.documentVectorBytes !== VECTOR_BYTES)
    ) {
      schemaMismatch(version, `resume ${resume.id} has an invalid document vector`)
    }
  }
}

interface StoredChunkRow {
  id: number
  resumeId: number
  section: unknown
  sectionType: string
  ordinal: unknown
  ordinalType: string
  textType: string
  textChars: number
  embeddingType: string
  embeddingBytes: number | null
}

function assertChunkRows(database: Database.Database, version: number): void {
  const rows = database
    .prepare(
      `SELECT id, resume_id AS resumeId,
              section, typeof(section) AS sectionType,
              ordinal, typeof(ordinal) AS ordinalType,
              typeof(text) AS textType, length(text) AS textChars,
              typeof(embedding) AS embeddingType, length(embedding) AS embeddingBytes
       FROM chunks
       ORDER BY id`
    )
    .iterate() as IterableIterator<StoredChunkRow>

  for (const chunk of rows) {
    if (
      !Number.isSafeInteger(chunk.id) ||
      chunk.id <= 0 ||
      !Number.isSafeInteger(chunk.resumeId) ||
      chunk.resumeId <= 0 ||
      chunk.sectionType !== 'text' ||
      typeof chunk.section !== 'string' ||
      !SECTION_KINDS.has(chunk.section)
    ) {
      schemaMismatch(version, `chunk ${chunk.id} has an invalid section or identity`)
    }
    if (
      chunk.ordinalType !== 'integer' ||
      !Number.isSafeInteger(chunk.ordinal) ||
      Number(chunk.ordinal) < 0 ||
      Number(chunk.ordinal) >= DATABASE_LIMITS.chunksPerResume
    ) {
      schemaMismatch(version, `chunk ${chunk.id} has an invalid ordinal`)
    }
    if (
      chunk.textType !== 'text' ||
      !Number.isInteger(chunk.textChars) ||
      chunk.textChars < 1 ||
      chunk.textChars > DATABASE_LIMITS.chunkTextChars
    ) {
      schemaMismatch(version, `chunk ${chunk.id} has invalid text`)
    }
    if (chunk.embeddingType !== 'blob' || chunk.embeddingBytes !== VECTOR_BYTES) {
      schemaMismatch(version, `chunk ${chunk.id} has an invalid embedding vector`)
    }
  }
}

function assertFiniteVectors(database: Database.Database, version: number): void {
  const chunks = database
    .prepare('SELECT id, embedding FROM chunks ORDER BY id')
    .iterate() as IterableIterator<{ id: number; embedding: Buffer }>
  for (const chunk of chunks) {
    for (let offset = 0; offset < chunk.embedding.length; offset += 4) {
      if (!Number.isFinite(chunk.embedding.readFloatLE(offset))) {
        schemaMismatch(version, `chunk ${chunk.id} has a non-finite embedding vector`)
      }
    }
  }

  if (version < 2) return
  const resumes = database
    .prepare("SELECT id, doc_vector AS documentVector FROM resumes WHERE typeof(doc_vector) = 'blob' ORDER BY id")
    .iterate() as IterableIterator<{ id: number; documentVector: Buffer }>
  for (const resume of resumes) {
    for (let offset = 0; offset < resume.documentVector.length; offset += 4) {
      if (!Number.isFinite(resume.documentVector.readFloatLE(offset))) {
        schemaMismatch(version, `resume ${resume.id} has a non-finite document vector`)
      }
    }
  }
}

function assertSettingsRows(database: Database.Database, version: number): void {
  const rows = database
    .prepare(
      'SELECT key, typeof(key) AS keyType, value, typeof(value) AS valueType FROM settings ORDER BY key'
    )
    .iterate() as IterableIterator<{
    key: unknown
    keyType: string
    value: unknown
    valueType: string
  }>

  for (const setting of rows) {
    if (
      !validRequiredText(setting.key, setting.keyType, DATABASE_LIMITS.settingKeyChars) ||
      !validOptionalText(setting.value, setting.valueType, DATABASE_LIMITS.settingValueChars) ||
      /[\u0000-\u001f\u007f]/.test(setting.key)
    ) {
      schemaMismatch(version, 'a stored setting is malformed')
    }
    if (
      setting.key === 'embeddingModel' &&
      setting.value !== null &&
      !(
        typeof setting.value === 'string' &&
        setting.value.length <= 512 &&
        !/[\u0000-\u001f\u007f]/.test(setting.value)
      )
    ) {
      schemaMismatch(version, 'the embedding-model provenance marker is invalid')
    }
  }
}

function assertStoredData(database: Database.Database, version: number): void {
  // The cheap BLOB byte budget runs before the bounded NUL scan; both happen
  // before any values or vectors are materialised.
  // Once they pass, each iterator holds only one bounded row at a time.
  assertAggregateLimits(database, version)
  assertNoEmbeddedNul(database, version)
  assertResumeRows(database, version)
  assertChunkRows(database, version)
  assertFiniteVectors(database, version)
  assertSettingsRows(database, version)
  if (version >= 4) assertRecruitingData(database)
}

function assertDatabaseMatchesVersion(database: Database.Database, version: number): void {
  assertObjects(database, version)
  assertTableMetadata(database, version)
  assertIndexes(database, version)
  assertForeignKeys(database, version)
  assertStoredData(database, version)
}

/** Rebuilds external-content FTS postings and asks FTS5 to compare them to resumes. */
export function rebuildAndVerifySearchIndex(database: Database.Database): void {
  database.transaction(() => {
    database.exec("INSERT INTO resumes_fts(resumes_fts) VALUES ('rebuild')")
    // rank=1 enables the external-content comparison, not only the index's
    // internal checksum validation.
    database.exec(
      "INSERT INTO resumes_fts(resumes_fts, rank) VALUES ('integrity-check', 1)"
    )
  })()
}

export function pragmaNumber(database: Database.Database, name: 'application_id' | 'user_version'): number {
  return database.pragma(name, { simple: true }) as number
}

function setPragmaNumber(
  database: Database.Database,
  name: 'application_id' | 'user_version',
  value: number
): void {
  database.pragma(`${name} = ${value}`)
}

interface Migration {
  version: number
  up(database: Database.Database): void
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up(database) {
      database.exec(PUBLISHED_SCHEMA_V1_SQL)
    }
  },
  {
    version: 2,
    up(database) {
      // Mean of the chunk vectors, used to make near-duplicate scans linear.
      database.exec('ALTER TABLE resumes ADD COLUMN doc_vector BLOB')
    }
  },
  {
    version: 3,
    up(database) {
      // Identifies rows that need a skill-gazetteer backfill.
      database.exec("ALTER TABLE resumes ADD COLUMN skills_version TEXT NOT NULL DEFAULT ''")
    }
  },
  {
    version: 4,
    up(database) {
      database.exec(RECRUITING_TABLE_SQL)
    }
  },
  {
    version: 5,
    up() {
      // Saved search JSON can now retain Claude order/reasons. Existing records
      // need no rewrite; the version keeps older strict readers from opening it.
    }
  },
  {
    version: 6,
    up() {
      // Jobs can retain timestamped status decisions and hiring selections.
      // Legacy jobs keep unknown transition dates rather than fabricated history.
    }
  },
  {
    version: 7,
    up() {
      // Saved AI rankings now identify the provider and model that produced them.
      // Older Claude rankings remain readable without rewriting their evidence.
    }
  },
  {
    version: 8,
    up() {
      // Company records, job budgets, and target-company research are optional.
      // Advance the version so older strict readers cannot open these records.
    }
  },
  {
    version: 9,
    up() {
      // Stable contacts, activity history, pipelines, screening kits and talent
      // pools share bounded recruiting storage; older readers must not open it.
    }
  },
  {
    version: 10,
    up() {
      // Criteria can retain original posting text and unspecified importance.
      // Preserve legacy records verbatim; prevent older strict JSON readers
      // from treating the expanded contract as malformed recruiting data.
    }
  },
  {
    version: 11,
    up() {
      // Company details can contain multiple values. Normalize legacy strings
      // when read, without rewriting saved values or their company identities.
      // Older strict readers must not open the expanded array-valued records.
    }
  },
  {
    version: 12,
    up() {
      // Company hiring-cost plans add a versioned record kind. Existing company
      // and job records retain their identities and original data verbatim.
    }
  }
]

export interface MigrationResult {
  fromVersion: number
  toVersion: number
  adoptedLegacySchema: boolean
}

/** Throws when the database is not the exact known Qumaa shape for `version`. */
export function assertSchemaVersion(database: Database.Database, version: number): void {
  const shape = inspectSchema(database)
  // Legacy adoption remains limited to the three schemas actually shipped
  // without a version header. Recruiting versions must carry the application identity.
  const inferred = inferPublishedSchemaVersion(version >= 4
    ? { ...shape, objects: shape.objects.filter((name) =>
        name !== 'recruiting_records' && name !== 'sqlite_autoindex_recruiting_records_1'
      ) }
    : shape)
  if (inferred !== (version >= 4 ? 3 : version)) {
    throw new Error(
      `The database schema does not match Qumaa schema version ${version} (detected ${String(inferred)}).`
    )
  }
  assertDatabaseMatchesVersion(database, version)
}

/**
 * Adopts legacy published databases and applies every pending migration, one
 * transaction at a time.  `user_version` advances in the same transaction as
 * its schema change, so a failed migration is safe to retry.
 */
export function migrateDatabase(database: Database.Database): MigrationResult {
  const applicationId = pragmaNumber(database, 'application_id')
  let version = pragmaNumber(database, 'user_version')
  const fromVersion = version
  let adoptedLegacySchema = false

  if (applicationId !== 0 && applicationId !== QUMAA_APPLICATION_ID) {
    throw new Error('This database belongs to another application.')
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This database was created by a newer Qumaa version (schema ${version}; supported through ${CURRENT_SCHEMA_VERSION}).`
    )
  }

  if (version === 0) {
    const inferred = inferPublishedSchemaVersion(inspectSchema(database))
    if (inferred === null) {
      throw new Error('The existing database is not a recognised published Qumaa schema.')
    }
    if (inferred > 0) {
      // Do not stamp application identity onto a merely similar database. The
      // complete published structure and stored-value invariants must match.
      assertDatabaseMatchesVersion(database, inferred)
      database.transaction(() => {
        setPragmaNumber(database, 'application_id', QUMAA_APPLICATION_ID)
        setPragmaNumber(database, 'user_version', inferred)
      })()
      version = inferred
      adoptedLegacySchema = true
    }
  } else {
    if (applicationId !== QUMAA_APPLICATION_ID) {
      throw new Error('A versioned database is missing Qumaa application identity.')
    }
    assertSchemaVersion(database, version)
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue
    database.transaction(() => {
      migration.up(database)
      setPragmaNumber(database, 'application_id', QUMAA_APPLICATION_ID)
      setPragmaNumber(database, 'user_version', migration.version)
    })()
    version = migration.version
  }

  assertSchemaVersion(database, CURRENT_SCHEMA_VERSION)
  return {
    fromVersion,
    toVersion: CURRENT_SCHEMA_VERSION,
    adoptedLegacySchema
  }
}
