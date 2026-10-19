import { describe, expect, it } from 'vitest'
import { mkdir, rename, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  canonicalizeWatchedRoot,
  isCanonicalPathWithinRoot,
  readValidatedFileSource,
  validateFileSource,
  validateWatchedFileSource
} from '../src/main/ingest/source-file.js'
import { temporaryDirectories } from './fixtures/temporary.js'

const scratch = temporaryDirectories('qumaa-source-boundary-')
const temporaryDirectory = (): Promise<string> => scratch.create()

async function linkDirectory(target: string, path: string): Promise<void> {
  await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('resume source filesystem boundary', () => {
  it('applies case-insensitive Windows containment after junction resolution', () => {
    const root = 'C:\\Users\\Recruiter\\Resumes'
    const lexicalEvent = 'c:\\users\\recruiter\\resumes\\linked\\candidate.pdf'
    const junctionTarget = 'D:\\External\\candidate.pdf'

    expect(isCanonicalPathWithinRoot(root, lexicalEvent, 'win32')).toBe(true)
    expect(isCanonicalPathWithinRoot(root, junctionTarget, 'win32')).toBe(false)
    expect(
      isCanonicalPathWithinRoot(root, 'C:\\Users\\Recruiter\\Resumes-copy\\candidate.pdf', 'win32')
    ).toBe(false)
  })

  it('rejects a nested symlink or Windows junction that resolves outside the watched root', async () => {
    const base = await temporaryDirectory()
    const rootPath = join(base, 'watched')
    const outside = join(base, 'outside')
    await mkdir(rootPath)
    await mkdir(outside)
    await writeFile(join(outside, 'candidate.md'), 'outside candidate')
    await linkDirectory(outside, join(rootPath, 'linked'))

    const root = await canonicalizeWatchedRoot(rootPath)
    await expect(
      validateWatchedFileSource(root, join(rootPath, 'linked', 'candidate.md'))
    ).rejects.toThrow('resolves outside')
  })

  it('rejects nested-parent substitution between validation and descriptor open', async () => {
    const base = await temporaryDirectory()
    const rootPath = join(base, 'watched')
    const nested = join(rootPath, 'nested')
    const retained = join(rootPath, 'retained-nested')
    const outside = join(base, 'outside')
    await mkdir(rootPath)
    await mkdir(nested)
    await mkdir(outside)
    await writeFile(join(nested, 'candidate.md'), 'validated candidate')
    await writeFile(join(outside, 'candidate.md'), 'substituted candidate')

    const root = await canonicalizeWatchedRoot(rootPath)
    const source = await validateWatchedFileSource(root, join(nested, 'candidate.md'))

    await rename(nested, retained)
    await linkDirectory(outside, nested)

    await expect(readValidatedFileSource(source)).rejects.toThrow('not a stable')
  })

  it('reads an unchanged regular file through its validated descriptor identity', async () => {
    const base = await temporaryDirectory()
    const path = join(base, 'candidate.md')
    await writeFile(path, '# Candidate\nVerified experience')

    const source = await validateFileSource(path)
    const contents = await readValidatedFileSource(source)

    expect(contents.toString('utf8')).toBe('# Candidate\nVerified experience')
  })
})
