/** Crash-recovery marker for replacing the live SQLite file during restore. */
import {
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

export interface RestoreMarker {
  livePath: string
  stagingPath: string
  rollbackPath: string
}

export function restoreMarkerPath(livePath: string): string {
  return `${livePath}.restore-in-progress.json`
}

function syncPath(path: string): void {
  let descriptor: number | null = null
  try {
    descriptor = openSync(path, 'r')
    fsyncSync(descriptor)
  } catch {
    // Some filesystems/platforms do not permit fsync on directories. Rename
    // recovery still applies; durability is strengthened wherever supported.
  } finally {
    if (descriptor !== null) closeSync(descriptor)
  }
}

export function syncFileAndDirectory(path: string): void {
  syncPath(path)
  syncPath(dirname(path))
}

function isRegularUnlinkedPath(path: string): boolean {
  if (!existsSync(path)) return true
  const stat = lstatSync(path)
  return stat.isFile() && !stat.isSymbolicLink()
}

export function isManagedRollbackPath(livePath: string, candidate: string): boolean {
  return (
    dirname(candidate) === dirname(livePath) &&
    basename(candidate).startsWith(`${basename(livePath)}.rollback-`)
  )
}

export function isManagedStagingPath(livePath: string, candidate: string): boolean {
  return (
    dirname(candidate) === dirname(livePath) &&
    basename(candidate).startsWith(`.${basename(livePath)}.`)
  )
}

function validateMarker(livePath: string, marker: RestoreMarker): RestoreMarker {
  if (marker.livePath !== livePath) {
    throw new Error('Qumaa found a restore recovery marker for another database.')
  }
  if (
    !isManagedStagingPath(livePath, marker.stagingPath) ||
    !isManagedRollbackPath(livePath, marker.rollbackPath) ||
    !isRegularUnlinkedPath(marker.livePath) ||
    !isRegularUnlinkedPath(marker.stagingPath) ||
    !isRegularUnlinkedPath(marker.rollbackPath)
  ) {
    throw new Error('Qumaa found an invalid restore recovery marker.')
  }
  return marker
}

export function readRestoreMarker(livePath: string): RestoreMarker | null {
  const path = restoreMarkerPath(livePath)
  if (!existsSync(path)) return null
  try {
    return validateMarker(livePath, JSON.parse(readFileSync(path, 'utf8')) as RestoreMarker)
  } catch (error) {
    if (error instanceof Error && error.message.includes('restore recovery marker')) throw error
    throw new Error('Qumaa found an unreadable restore recovery marker.', { cause: error })
  }
}

/** Written before the live file moves; startup can then always recover it. */
export function writeRestoreMarker(marker: RestoreMarker): void {
  validateMarker(marker.livePath, marker)
  const path = restoreMarkerPath(marker.livePath)
  const temporaryPath = `${path}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(marker), { encoding: 'utf8', mode: 0o600 })
  syncFileAndDirectory(temporaryPath)
  renameSync(temporaryPath, path)
  syncFileAndDirectory(path)
}

export function clearRestoreMarker(livePath: string): void {
  rmSync(restoreMarkerPath(livePath), { force: true })
  rmSync(`${restoreMarkerPath(livePath)}.tmp`, { force: true })
  syncPath(dirname(livePath))
}

function removeDatabaseFileSet(path: string): void {
  rmSync(path, { force: true })
  rmSync(`${path}-wal`, { force: true })
  rmSync(`${path}-shm`, { force: true })
}

/** Moves the main SQLite file and any closed WAL sidecars as one recoverable set. */
export function moveClosedDatabaseFileSet(from: string, to: string): void {
  renameSync(from, to)
  if (existsSync(`${from}-wal`)) renameSync(`${from}-wal`, `${to}-wal`)
  if (existsSync(`${from}-shm`)) renameSync(`${from}-shm`, `${to}-shm`)
  syncPath(dirname(from))
}

/**
 * Conservatively recovers an interrupted replacement.
 *
 * If the old live database reached the rollback path, it always wins: a
 * restore is not considered committed until the marker is removed.  If the
 * move never happened, the untouched live file remains in place.
 */
export function recoverInterruptedRestore(livePath: string): boolean {
  const marker = readRestoreMarker(livePath)
  if (!marker) return false

  if (existsSync(marker.rollbackPath)) {
    let displacedLive = false
    if (existsSync(livePath)) {
      removeDatabaseFileSet(marker.stagingPath)
      moveClosedDatabaseFileSet(livePath, marker.stagingPath)
      displacedLive = true
    }
    try {
      moveClosedDatabaseFileSet(marker.rollbackPath, livePath)
    } catch (error) {
      if (displacedLive) moveClosedDatabaseFileSet(marker.stagingPath, livePath)
      throw error
    }
  } else if (!existsSync(livePath) && existsSync(marker.stagingPath)) {
    // Last-resort recovery if there was no original file to roll back to.
    moveClosedDatabaseFileSet(marker.stagingPath, livePath)
  }

  removeDatabaseFileSet(marker.stagingPath)
  clearRestoreMarker(livePath)
  return true
}

/**
 * Removes abandoned private stages and historical rollback files after marker
 * recovery has completed. Never call while an in-progress marker exists.
 */
export function pruneStaleDatabaseArtifacts(livePath: string): void {
  if (readRestoreMarker(livePath)) return
  const directory = dirname(livePath)
  const liveName = basename(livePath)
  for (const name of readdirSync(directory)) {
    if (name.startsWith(`.${liveName}.`) || name.startsWith(`${liveName}.rollback-`)) {
      removeDatabaseFileSet(join(directory, name))
    }
  }
  syncPath(directory)
}
