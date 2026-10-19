/** Bounded, synthetic database security regressions; run only inside Electron. */
import Database from 'better-sqlite3'
import { copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertSchemaVersion,
  CURRENT_SCHEMA_VERSION,
  migrateDatabase,
  PUBLISHED_SCHEMA_V1_SQL,
  QUMAA_APPLICATION_ID
} from './db/migrations.js'
import { validatePortableBackup } from './db/backup.js'
import { RECRUITING_TABLE_SQL } from './recruiting/storage.js'

type Check = (label: string, ok: boolean, detail?: string) => void

function createVersionedFixture(path: string, version: number, freshV3 = false): void {
  const database = new Database(path)
  try {
    database.exec(freshV3
      ? PUBLISHED_SCHEMA_V1_SQL.replace(
          'likely_scanned   INTEGER',
          "skills_version TEXT NOT NULL DEFAULT '', likely_scanned   INTEGER"
        )
      : PUBLISHED_SCHEMA_V1_SQL)
    if (version >= 2) database.exec('ALTER TABLE resumes ADD COLUMN doc_vector BLOB')
    if (version >= 3 && !freshV3) {
      database.exec("ALTER TABLE resumes ADD COLUMN skills_version TEXT NOT NULL DEFAULT ''")
    }
    if (version >= 4) database.exec(RECRUITING_TABLE_SQL)
    database.pragma(`application_id = ${QUMAA_APPLICATION_ID}`)
    database.pragma(`user_version = ${version}`)
  } finally {
    database.close()
  }
}

function alterStoredSql(database: Database.Database, name: string, change: (sql: string) => string): void {
  const row = database.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').get(name) as { sql: string }
  // Fixture construction only: model bytes produced by a different SQLite
  // writer. Production connections retain better-sqlite3's defensive mode.
  database.unsafeMode(true)
  database.pragma('writable_schema = ON')
  database.prepare('UPDATE sqlite_schema SET sql = ? WHERE name = ?').run(change(row.sql), name)
  database.pragma('writable_schema = OFF')
  database.unsafeMode(false)
}

export function runSchemaSecuritySmoke(check: Check, scratch: string): void {
  console.log('\n1a. Complete SQLite schema identity')
  for (let version = 1; version <= CURRENT_SCHEMA_VERSION; version++) {
    for (const freshV3 of version >= 3 ? [false, true] : [false]) {
      const path = join(scratch, `security-legitimate-v${version}-${freshV3}.qumaa-backup`)
      createVersionedFixture(path, version, freshV3)
      const validated = validatePortableBackup(path)
      const database = new Database(path)
      const migration = migrateDatabase(database)
      database.close()
      check(
        `validates and migrates genuine v${version}${freshV3 ? ' fresh-v3 column order' : ''}`,
        validated.schemaVersion === version && migration.toVersion === CURRENT_SCHEMA_VERSION
      )
    }
  }

  // A real callback confirms schema rejection precedes CHECK evaluation. The
  // positive control invokes only this harmless callback, never a large allocation.
  let constraintCalls = 0
  const probe = new Database(':memory:')
  probe.function('smoke_constraint_probe', () => { constraintCalls++; return 1 })
  probe.exec(PUBLISHED_SCHEMA_V1_SQL.replace('value TEXT', 'value TEXT CHECK (smoke_constraint_probe())'))
  probe.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('theme', 'dark')
  constraintCalls = 0
  probe.pragma('quick_check(1)')
  check('positive control: SQLite integrity checks evaluate table constraints', constraintCalls === 1)
  constraintCalls = 0
  let probeRejection = ''
  try { assertSchemaVersion(probe, 1) } catch (error) { probeRejection = String(error) }
  check(
    'rejects injected CHECK SQL before invoking its expression',
    probeRejection.includes('settings has altered SQL') && constraintCalls === 0
  )
  let adoptionRejected = false
  try { migrateDatabase(probe) } catch { adoptionRejected = true }
  check(
    'rejects injected CHECK SQL before legacy adoption changes the database',
    adoptionRejected && constraintCalls === 0 &&
      probe.pragma('application_id', { simple: true }) === 0 &&
      probe.pragma('user_version', { simple: true }) === 0
  )
  probe.close()

  const basePath = join(scratch, 'security-base.qumaa-backup')
  createVersionedFixture(basePath, 1)
  const cases: Array<{ name: string; mutate: (database: Database.Database) => void }> = [
    {
      name: 'column-check',
      mutate: (database) => alterStoredSql(database, 'settings', (sql) =>
        sql.replace('value TEXT', 'value TEXT CHECK (length(hex(zeroblob(1024))) > 0)'))
    },
    ...['resumes', 'chunks', 'settings', 'resumes_fts_data', 'resumes_fts_idx', 'resumes_fts_docsize', 'resumes_fts_config'].map((table) => ({
      name: `table-check-${table}`,
      mutate: (database: Database.Database) => alterStoredSql(database, table, (sql) => {
        const end = sql.lastIndexOf(')')
        return `${sql.slice(0, end)}, CHECK (length(hex(zeroblob(1024))) > 0)${sql.slice(end)}`
      })
    })),
    {
      name: 'index-expression',
      mutate: (database) => {
        database.exec('DROP INDEX idx_chunks_resume')
        database.exec('CREATE INDEX idx_chunks_resume ON chunks(resume_id + 0)')
      }
    },
    {
      // LIKE 'sqlite_%' accidentally treats the underscore as a wildcard.
      name: 'sqlite-prefix-lookalike',
      mutate: (database) => database.exec('CREATE TABLE sqliteevil (value TEXT CHECK (length(hex(zeroblob(1024))) > 0))')
    },
    {
      // Even actual sqlite_* objects cannot be excluded from validation.
      name: 'sqlite-internal-table',
      mutate: (database) => {
        database.exec('ANALYZE')
        alterStoredSql(database, 'sqlite_stat1', (sql) =>
          `${sql.slice(0, -1)}, CHECK (length(hex(zeroblob(1024))) > 0))`)
      }
    },
    {
      name: 'implicit-index-sql',
      mutate: (database) => {
        database.unsafeMode(true)
        database.pragma('writable_schema = ON')
        database.prepare('UPDATE sqlite_schema SET sql = ? WHERE name = ?')
          .run('CREATE INDEX sqlite_autoindex_settings_1 ON settings(key)', 'sqlite_autoindex_settings_1')
        database.pragma('writable_schema = OFF')
        database.unsafeMode(false)
      }
    }
  ]
  for (const fixture of cases) {
    const path = join(scratch, `security-${fixture.name}.qumaa-backup`)
    copyFileSync(basePath, path)
    const database = new Database(path)
    fixture.mutate(database)
    database.close()
    const original = readFileSync(path)
    let rejected = false
    try { validatePortableBackup(path) } catch { rejected = true }
    check(`rejects ${fixture.name} without changing its source backup`, rejected && readFileSync(path).equals(original))
  }
}
