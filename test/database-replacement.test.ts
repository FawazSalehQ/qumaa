import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  recoverInterruptedRestore,
  restoreMarkerPath,
  writeRestoreMarker
} from '../src/main/db/replacement.js'

const scratchDirectories: string[] = []

function scratch(): string {
  const path = mkdtempSync(join(tmpdir(), 'qumaa-restore-test-'))
  scratchDirectories.push(path)
  return path
}

afterEach(() => {
  for (const path of scratchDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('database replacement crash recovery', () => {
  it('restores the old database if a crash happens after replacement', () => {
    const directory = scratch()
    const livePath = join(directory, 'cv_filter.db')
    const stagingPath = join(directory, '.cv_filter.db.restore-test')
    const rollbackPath = join(directory, 'cv_filter.db.rollback-test')
    writeFileSync(livePath, 'old')
    writeFileSync(stagingPath, 'new')
    writeRestoreMarker({ livePath, stagingPath, rollbackPath })

    renameSync(livePath, rollbackPath)
    renameSync(stagingPath, livePath)

    expect(recoverInterruptedRestore(livePath)).toBe(true)
    expect(readFileSync(livePath, 'utf8')).toBe('old')
    expect(() => readFileSync(restoreMarkerPath(livePath))).toThrow()
  })

  it('keeps the untouched live database if the first move never happened', () => {
    const directory = scratch()
    const livePath = join(directory, 'cv_filter.db')
    const stagingPath = join(directory, '.cv_filter.db.restore-test')
    const rollbackPath = join(directory, 'cv_filter.db.rollback-test')
    writeFileSync(livePath, 'old')
    writeFileSync(stagingPath, 'new')
    writeRestoreMarker({ livePath, stagingPath, rollbackPath })

    expect(recoverInterruptedRestore(livePath)).toBe(true)
    expect(readFileSync(livePath, 'utf8')).toBe('old')
    expect(() => readFileSync(stagingPath)).toThrow()
  })

  it('rejects marker paths outside the live database directory', () => {
    const directory = scratch()
    const outsideDirectory = scratch()
    const livePath = join(directory, 'cv_filter.db')
    const outsidePath = join(outsideDirectory, 'do-not-touch')
    writeFileSync(livePath, 'old')
    writeFileSync(outsidePath, 'private')
    writeFileSync(
      restoreMarkerPath(livePath),
      JSON.stringify({
        livePath,
        stagingPath: outsidePath,
        rollbackPath: join(directory, 'cv_filter.db.rollback-test')
      })
    )

    expect(() => recoverInterruptedRestore(livePath)).toThrow(/invalid restore recovery marker/)
    expect(readFileSync(outsidePath, 'utf8')).toBe('private')
  })
})
