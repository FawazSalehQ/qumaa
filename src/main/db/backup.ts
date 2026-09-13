/** Portable SQLite backup, validation, restore, and rollback primitives. */
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { isPortableSetting } from './backup-policy.js'
import { closeDbForMaintenance, dbPath, getDb } from './index.js'
import {
  assertSchemaVersion,
  CURRENT_SCHEMA_VERSION,
  migrateDatabase,
  QUMAA_APPLICATION_ID,
  rebuildAndVerifySearchIndex
} from './migrations.js'
import {
  clearRestoreMarker,
  isManagedRollbackPath,
  isManagedStagingPath,
  moveClosedDatabaseFileSet,
  readRestoreMarker,
  recoverInterruptedRestore,
  syncFileAndDirectory,
  writeRestoreMarker
} from './replacement.js'
import { rebuildRestoredDerivedData } from '../ingest/restore-rebuild.js'
import { pruneRecruitingRecords } from '../recruiting/storage.js'
import { temporarySearch } from '../recruiting/temporary.js'

export interface BackupValidation {
  schemaVersion: number
  resumeCount: number
  chunkCount: number
}

export interface RestoreResult extends BackupValidation {
  /** Exact pre-restore database. Keep it until the restored library is accepted. */
  rollbackPath: string
}

export interface StagedRestore extends BackupValidation {
  readonly sourcePath: string
  readonly stagingPath: string
}

/** The 3,000-resume benchmark is far below this; larger files fail before SQLite opens them. */
export const MAX_PORTABLE_BACKUP_BYTES = 1024 * 1024 * 1024

function pragmaNumber(database: Database.Database, name: 'application_id' | 'user_version'): number {
  return database.pragma(name, { simple: true }) as number
}

function assertDatabaseSizeBudget(database: Database.Database): void {
  const pageCount = database.pragma('page_count', { simple: true }) as number
  const pageSize = database.pragma('page_size', { simple: true }) as number
  if (
    !Number.isSafeInteger(pageCount) ||
    pageCount < 0 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize <= 0 ||
    pageCount * pageSize > MAX_PORTABLE_BACKUP_BYTES
  ) {
    throw new Error('The selected backup exceeds Qumaa\'s 1 GB logical database limit.')
  }
}

function assertQuickCheck(database: Database.Database): void {
  // quick_check(1) and get() cap diagnostic material even for a malicious file.
  const row = database.prepare('PRAGMA quick_check(1)').get() as
    | Record<string, unknown>
    | undefined
  const result = row ? Object.values(row)[0] : undefined
  if (result !== 'ok') {
    throw new Error(`SQLite quick_check failed: ${String(result ?? 'no result')}`)
  }
  // The existence of one broken edge is enough to reject the backup. Do not
  // materialise an attacker-controlled list of every broken foreign key.
  if (database.prepare('PRAGMA foreign_key_check').get() !== undefined) {
    throw new Error('The backup contains one or more broken database references.')
  }
}

function inspectOpenDatabase(
  database: Database.Database,
  requirePortable: boolean
): BackupValidation {
  // This includes committed WAL frames visible through the open connection and
  // runs before any integrity, schema, JSON, or vector scan.
  assertDatabaseSizeBudget(database)
  const applicationId = pragmaNumber(database, 'application_id')
  if (applicationId !== QUMAA_APPLICATION_ID) {
    throw new Error('The selected file is not a Qumaa backup.')
  }

  const schemaVersion = pragmaNumber(database, 'user_version')
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This backup requires a newer Qumaa version (schema ${schemaVersion}; supported through ${CURRENT_SCHEMA_VERSION}).`
    )
  }
  if (schemaVersion < 1) {
    throw new Error('The selected file does not contain a versioned Qumaa database.')
  }

  assertSchemaVersion(database, schemaVersion)
  assertQuickCheck(database)

  if (requirePortable) {
    const settings = database
      .prepare('SELECT key FROM settings ORDER BY key')
      .iterate() as IterableIterator<{ key: string }>
    for (const { key } of settings) {
      if (!isPortableSetting(key)) {
        throw new Error(`The backup contains a non-portable setting: ${key}.`)
      }
    }

    const paths = database
      .prepare("SELECT COUNT(*) AS count FROM resumes WHERE file_path <> ''")
      .get() as { count: number }
    if (paths.count !== 0) {
      throw new Error('The backup contains machine-specific resume paths.')
    }
  }

  const resumeCount = (
    database.prepare('SELECT COUNT(*) AS count FROM resumes').get() as { count: number }
  ).count
  const chunkCount = (
    database.prepare('SELECT COUNT(*) AS count FROM chunks').get() as { count: number }
  ).count
  return { schemaVersion, resumeCount, chunkCount }
}

function openAndInspect(path: string, requirePortable: boolean): BackupValidation {
  assertRegularBackupFile(path)
  let database: Database.Database
  try {
    database = new Database(path, { readonly: true, fileMustExist: true })
  } catch (error) {
    throw new Error('The selected backup could not be opened.', { cause: error })
  }
  try {
    database.pragma('foreign_keys = ON')
    return inspectOpenDatabase(database, requirePortable)
  } finally {
    database.close()
  }
}

/** Validates identity, supported schema, portability policy, and SQLite integrity. */
export function validatePortableBackup(path: string): BackupValidation {
  return openAndInspect(path, true)
}

function makePrivate(path: string): void {
  try {
    chmodSync(path, 0o600)
  } catch {
    // Windows does not implement POSIX mode bits. Its user profile ACL remains in force.
  }
}

function reservePrivateFile(path: string): void {
  const descriptor = openSync(path, 'wx', 0o600)
  closeSync(descriptor)
}

function removeDatabaseFileSet(path: string): void {
  rmSync(path, { force: true })
  rmSync(`${path}-wal`, { force: true })
  rmSync(`${path}-shm`, { force: true })
  rmSync(`${path}-journal`, { force: true })
}

function prepareCandidate(path: string, portable: boolean): BackupValidation {
  assertRegularBackupFile(path)
  const database = new Database(path, { fileMustExist: true })
  try {
    database.pragma('foreign_keys = ON')
    assertDatabaseSizeBudget(database)
    migrateDatabase(database)
    if (portable) {
      database.transaction(() => {
        database.prepare("UPDATE resumes SET file_path = ''").run()
        const settings = database
          .prepare('SELECT key FROM settings ORDER BY key')
          .iterate() as IterableIterator<{ key: string }>
        const keysToRemove: string[] = []
        for (const { key } of settings) {
          if (!isPortableSetting(key)) keysToRemove.push(key)
        }
        const removeSetting = database.prepare('DELETE FROM settings WHERE key = ?')
        for (const key of keysToRemove) removeSetting.run(key)
        // Portable files are untrusted input when restored. Force a complete
        // re-embed from retained text under the bundled, hash-verified model;
        // a forged provenance marker can never make arbitrary vectors trusted.
        removeSetting.run('embeddingModel')
        // Recruiter decisions and profile corrections are portable. Rankings
        // are local machine-derived assertions and must be recomputed after
        // restore before they can create a trusted Claude search session.
        database.prepare("DELETE FROM recruiting_records WHERE kind = 'snapshot'").run()
      })()
    }

    // The FTS5 table is derived data. Rebuilding on the isolated candidate
    // makes stale/tampered postings harmless, then verifies external-content
    // consistency before the file can be published or installed.
    rebuildAndVerifySearchIndex(database)

    // A portable backup is one standalone file, never a database plus WAL sidecars.
    database.pragma('journal_mode = DELETE')
    database.exec('VACUUM')
    syncFileAndDirectory(path)
    return inspectOpenDatabase(database, portable)
  } finally {
    database.close()
  }
}

function stagingPathFor(destination: string, label: string): string {
  return resolve(dirname(destination), `.${basename(destination)}.${label}-${randomUUID()}`)
}

function caseFold(path: string): string {
  return path.normalize('NFC').toLocaleLowerCase('en-US')
}

function canonicalParent(path: string): string {
  return realpathSync.native(dirname(path))
}

function sameExistingFile(left: string, right: string): boolean {
  if (!existsSync(left) || !existsSync(right)) return false
  const a = lstatSync(left)
  const b = lstatSync(right)
  return a.dev === b.dev && a.ino === b.ino
}

function assertOutsideLiveNamespace(candidate: string): void {
  const livePath = resolve(dbPath())
  const candidateMembers = [candidate, `${candidate}-wal`, `${candidate}-shm`, `${candidate}-journal`]
  const liveMembers = [livePath, `${livePath}-wal`, `${livePath}-shm`, `${livePath}-journal`]
  if (
    candidateMembers.some((member) =>
      liveMembers.some((liveMember) => sameExistingFile(member, liveMember))
    )
  ) {
    throw new Error('A backup path cannot refer to Qumaa\'s live database.')
  }

  const sameDirectory = caseFold(canonicalParent(candidate)) === caseFold(canonicalParent(livePath))
  if (!sameDirectory) return
  const name = caseFold(basename(candidate))
  const liveName = caseFold(basename(livePath))
  if (
    name === liveName ||
    name === `${liveName}-wal` ||
    name === `${liveName}-shm` ||
    name === `${liveName}-journal` ||
    name === `${liveName}.restore-in-progress.json` ||
    name === `${liveName}.restore-in-progress.json.tmp` ||
    name.startsWith(`${liveName}.rollback-`) ||
    name.startsWith(`.${liveName}.`)
  ) {
    throw new Error('A backup path cannot use Qumaa\'s live database control files.')
  }
}

function assertRegularBackupFile(path: string): void {
  let totalBytes = 0
  for (const member of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
    if (member !== path && !existsSync(member)) continue
    let stat: ReturnType<typeof lstatSync>
    try {
      stat = lstatSync(member)
    } catch (error) {
      throw new Error('The selected backup could not be opened.', { cause: error })
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('The selected backup and its SQLite sidecars must be regular files, not links or directories.')
    }
    totalBytes += stat.size
  }
  if (totalBytes > MAX_PORTABLE_BACKUP_BYTES) {
    throw new Error('The selected backup exceeds Qumaa\'s 1 GB safety limit.')
  }
}

function assertRegularSource(path: string): void {
  assertRegularBackupFile(path)
  assertOutsideLiveNamespace(path)
}

function publishExport(stagingPath: string, destinationPath: string): void {
  // Linking a fully-written sibling stage is an atomic create on Windows and
  // macOS and, unlike rename, can never overwrite a file that appeared after
  // validation. Refuse overwrite so a crash cannot hide the previous backup.
  try {
    linkSync(stagingPath, destinationPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('A file already exists at the backup destination. Choose a new name.')
    }
    throw error
  }
  syncFileAndDirectory(destinationPath)
  removeDatabaseFileSet(stagingPath)
}

/**
 * Creates a consistent online backup while Qumaa remains open, sanitises its
 * portable copy, validates it, and only then publishes the destination file.
 */
export async function exportPortableBackup(destinationPath: string): Promise<BackupValidation> {
  const livePath = resolve(dbPath())
  const destination = resolve(destinationPath)
  mkdirSync(dirname(destination), { recursive: true })
  assertOutsideLiveNamespace(destination)
  if (existsSync(destination)) {
    throw new Error('A file already exists at the backup destination. Choose a new name.')
  }

  // The only stage containing the unsanitised live database stays inside
  // Qumaa's private userData directory. Nothing is copied beside the selected
  // destination until keys and machine paths have been removed and VACUUMed.
  const privateStage = stagingPathFor(livePath, 'backup-raw')
  const publishStage = stagingPathFor(destination, 'publish')
  try {
    reservePrivateFile(privateStage)
    await getDb().backup(privateStage)
    makePrivate(privateStage)
    const validation = prepareCandidate(privateStage, true)

    copyFileSync(privateStage, publishStage, constants.COPYFILE_EXCL)
    makePrivate(publishStage)
    syncFileAndDirectory(publishStage)
    publishExport(publishStage, destination)
    return validation
  } catch (error) {
    removeDatabaseFileSet(publishStage)
    throw error
  } finally {
    removeDatabaseFileSet(privateStage)
  }
}

function replaceManagedDatabase(stagingPath: string, portable: boolean): RestoreResult {
  const livePath = resolve(dbPath())
  const rollbackPath = `${livePath}.rollback-${Date.now()}-${randomUUID()}`

  // Ensure a live, migrated database exists before its handle is closed.
  getDb()
  closeDbForMaintenance()

  let markerWritten = false
  try {
    writeRestoreMarker({ livePath, stagingPath, rollbackPath })
    markerWritten = true
    moveClosedDatabaseFileSet(livePath, rollbackPath)
    moveClosedDatabaseFileSet(stagingPath, livePath)

    const validation = inspectOpenDatabase(getDb(), portable)
    return { ...validation, rollbackPath }
  } catch (error) {
    try {
      closeDbForMaintenance()
    } catch {
      // Reopening below is still preferable to masking the original restore failure.
    }
    if (markerWritten) {
      try {
        recoverInterruptedRestore(livePath)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'The restore failed and Qumaa could not put the original database back in place.'
        )
      }
    }

    try {
      getDb()
    } catch (reopenError) {
      throw new AggregateError(
        [error, reopenError],
        'The restore failed and Qumaa could not reopen the original database.'
      )
    }
    throw error
  }
}

/**
 * Captures the source connection (including committed WAL frames) into a
 * private, immutable candidate. The returned counts are for the exact bytes
 * that will be installed after confirmation.
 */
export async function stagePortableRestore(sourcePath: string): Promise<StagedRestore> {
  const source = resolve(sourcePath)
  const livePath = resolve(dbPath())
  mkdirSync(dirname(livePath), { recursive: true })
  assertRegularSource(source)
  const stagingPath = stagingPathFor(livePath, 'restore')
  let sourceDatabase: Database.Database | null = null
  try {
    sourceDatabase = new Database(source, { readonly: true, fileMustExist: true })
    sourceDatabase.pragma('foreign_keys = ON')
    inspectOpenDatabase(sourceDatabase, true)

    reservePrivateFile(stagingPath)
    await sourceDatabase.backup(stagingPath)
    makePrivate(stagingPath)
    const validation = prepareCandidate(stagingPath, true)
    return { ...validation, sourcePath: source, stagingPath }
  } catch (error) {
    removeDatabaseFileSet(stagingPath)
    throw error
  } finally {
    sourceDatabase?.close()
  }
}

/**
 * Installs only a private candidate produced by `stagePortableRestore`, then
 * rebuilds every ranking-relevant derivative while the original library is
 * still available as the marker-bound rollback.
 */
export async function installStagedPortableRestore(
  staged: StagedRestore
): Promise<RestoreResult> {
  const livePath = resolve(dbPath())
  const stagingPath = resolve(staged.stagingPath)
  if (!isManagedStagingPath(livePath, stagingPath) || !existsSync(stagingPath)) {
    throw new Error('The prepared restore candidate is no longer available.')
  }
  prepareCandidate(stagingPath, true)
  const installed = replaceManagedDatabase(stagingPath, true)
  try {
    const rebuilt = await rebuildRestoredDerivedData()
    getDb().transaction(() => pruneRecruitingRecords(getDb()))()
    // Re-run structural and stored-value validation against what Qumaa itself
    // derived. `false` permits the new local embedding provenance marker.
    const validation = inspectOpenDatabase(getDb(), false)
    if (
      validation.resumeCount !== rebuilt.resumeCount ||
      validation.chunkCount !== rebuilt.chunkCount
    ) {
      throw new Error('The restored search index changed while it was being validated.')
    }
    return { ...validation, rollbackPath: installed.rollbackPath }
  } catch (error) {
    try {
      rollbackRestore(installed.rollbackPath)
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Restore rebuilding failed and Qumaa could not put the original library back in place.'
      )
    }
    throw error
  }
}

export function discardStagedRestore(staged: StagedRestore): void {
  const livePath = resolve(dbPath())
  const stagingPath = resolve(staged.stagingPath)
  if (!isManagedStagingPath(livePath, stagingPath)) {
    throw new Error('Qumaa refused to remove an unknown restore candidate.')
  }
  removeDatabaseFileSet(stagingPath)
}

/** Convenience primitive for integration tests and non-UI callers. */
export async function restorePortableBackup(sourcePath: string): Promise<RestoreResult> {
  const staged = await stagePortableRestore(sourcePath)
  try {
    return await installStagedPortableRestore(staged)
  } catch (error) {
    removeDatabaseFileSet(staged.stagingPath)
    throw error
  }
}

/** Commits a fully initialized restore and securely drops its temporary rollback. */
export function commitRestore(rollbackPath: string): void {
  const livePath = resolve(dbPath())
  const rollback = resolve(rollbackPath)
  const marker = readRestoreMarker(livePath)
  if (
    !marker ||
    marker.rollbackPath !== rollback ||
    !isManagedRollbackPath(livePath, rollback)
  ) {
    throw new Error('Qumaa cannot commit an unknown restore operation.')
  }
  temporarySearch.clear()
  removeDatabaseFileSet(rollback)
  clearRestoreMarker(livePath)
}

/** Rolls back only the currently pending, marker-bound restore. */
export function rollbackRestore(rollbackPath: string): BackupValidation {
  const livePath = resolve(dbPath())
  const rollback = resolve(rollbackPath)
  const marker = readRestoreMarker(livePath)
  if (
    !marker ||
    marker.rollbackPath !== rollback ||
    !isManagedRollbackPath(livePath, rollback)
  ) {
    throw new Error('The selected file is not Qumaa\'s pending restore rollback.')
  }

  closeDbForMaintenance()
  try {
    recoverInterruptedRestore(livePath)
    return inspectOpenDatabase(getDb(), false)
  } catch (error) {
    try {
      getDb()
    } catch (reopenError) {
      throw new AggregateError(
        [error, reopenError],
        'Qumaa could not roll back or reopen the previous library.'
      )
    }
    throw error
  }
}
