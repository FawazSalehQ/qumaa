import { describe, expect, it } from 'vitest'
import { lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pruneReleases } from '../scripts/prune-releases.mjs'
import { temporaryDirectories } from './fixtures/temporary.js'

const scratch = temporaryDirectories('qumaa-prune-test-')
const CURRENT = '0.1.0-beta.3'
const MAC = `Qumaa-${CURRENT}-arm64.dmg`
const WIN = `Qumaa-${CURRENT}-Setup-x64.exe`

function fixture(names: string[]): string {
  const directory = scratch.createSync()
  for (const name of names) writeFileSync(join(directory, name), `fixture: ${name}`)
  return directory
}

function linkFixtureFile(file: string, targetDirectory: string, link: string): void {
  // Directory junctions exercise the same lstat/no-traversal guard on Windows
  // without requiring Developer Mode or symbolic-link privileges in CI.
  symlinkSync(process.platform === 'win32' ? targetDirectory : file, link, process.platform === 'win32' ? 'junction' : 'file')
}

describe('local release cleanup', () => {
  it('keeps the current version and other platform until their replacements exist', () => {
    const old = '0.1.0-beta.2'
    const directory = fixture([
      MAC, `${MAC}.blockmap`, WIN, `${WIN}.blockmap`, `SHA256SUMS-v${CURRENT}.txt`,
      `Qumaa-${old}-arm64.dmg`, `Qumaa-${old}-arm64.dmg.blockmap`,
      `Qumaa-${old}-Setup-x64.exe`, `Qumaa-${old}-Setup-x64.exe.blockmap`, `SHA256SUMS-v${old}.txt`,
      'latest.yml', 'latest-mac.yml', 'builder-debug.yml', 'notes.txt', 'another-app-1.0.0-arm64.dmg'
    ])
    mkdirSync(join(directory, 'mac-arm64'))
    mkdirSync(join(directory, 'win-unpacked'))
    expect(pruneReleases(directory, CURRENT, 'mac')).toEqual([
      `Qumaa-${old}-arm64.dmg`, `Qumaa-${old}-arm64.dmg.blockmap`
    ])
    expect(readdirSync(directory)).toContain(`SHA256SUMS-v${old}.txt`)
    expect(pruneReleases(directory, CURRENT, 'win')).toEqual([
      `Qumaa-${old}-Setup-x64.exe`, `Qumaa-${old}-Setup-x64.exe.blockmap`, `SHA256SUMS-v${old}.txt`
    ])
    expect(readdirSync(directory).sort()).toEqual([
      MAC, `${MAC}.blockmap`, WIN, `${WIN}.blockmap`, `SHA256SUMS-v${CURRENT}.txt`,
      'latest.yml', 'latest-mac.yml', 'builder-debug.yml', 'notes.txt', 'another-app-1.0.0-arm64.dmg',
      'mac-arm64', 'win-unpacked'
    ].sort())
  })

  it.each(['missing', 'empty', 'directory'])('leaves every old file untouched when the replacement is %s', (kind) => {
    const directory = fixture(['Qumaa-0.1.0-beta.2-arm64.dmg', 'SHA256SUMS-v0.1.0-beta.2.txt'])
    if (kind === 'empty') writeFileSync(join(directory, MAC), '')
    if (kind === 'directory') mkdirSync(join(directory, MAC))
    const before = readdirSync(directory).sort()
    expect(() => pruneReleases(directory, CURRENT, 'mac')).toThrow('must exist as a nonempty regular file')
    expect(readdirSync(directory).sort()).toEqual(before)
    expect(readFileSync(join(directory, 'Qumaa-0.1.0-beta.2-arm64.dmg'), 'utf8')).toContain('fixture:')
  })

  it('removes non-current renumbered versions, orphan blockmaps, and orphan manifests', () => {
    const directory = fixture([
      MAC, 'Qumaa-0.3.0-beta.2-arm64.dmg', 'Qumaa-0.2.0-arm64.dmg.blockmap',
      'SHA256SUMS-v0.3.0-beta.2.txt', 'SHA256SUMS-v0.2.0.txt',
      'Qumaa-manual-copy-arm64.dmg', 'Qumaa-0.2.0-arm64.dmg.backup', 'SHA256SUMS-vmanual.txt'
    ])
    expect(pruneReleases(directory, CURRENT, 'mac').sort()).toEqual([
      'Qumaa-0.3.0-beta.2-arm64.dmg', 'Qumaa-0.2.0-arm64.dmg.blockmap',
      'SHA256SUMS-v0.3.0-beta.2.txt', 'SHA256SUMS-v0.2.0.txt'
    ].sort())
    expect(readdirSync(directory).sort()).toEqual([
      MAC, 'Qumaa-manual-copy-arm64.dmg', 'Qumaa-0.2.0-arm64.dmg.backup', 'SHA256SUMS-vmanual.txt'
    ].sort())
  })

  it('rejects omitted/unknown platforms and unsafe versions before deleting anything', () => {
    const directory = fixture([MAC, 'Qumaa-0.1.0-beta.2-arm64.dmg'])
    for (const platform of [undefined, '', 'linux', '../mac', 'toString']) {
      expect(() => pruneReleases(directory, CURRENT, platform)).toThrow('Usage:')
    }
    expect(() => pruneReleases(directory, '../0.1.0', 'mac')).toThrow('package version')
    expect(readdirSync(directory)).toHaveLength(2)
  })

  it('does not traverse symlinked directories or accept a symlink as the new installer', () => {
    const outside = fixture([MAC, 'Qumaa-0.1.0-beta.2-arm64.dmg'])
    const directory = fixture(['Qumaa-0.1.0-beta.2-arm64.dmg'])
    const link = join(directory, 'release-link')
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => pruneReleases(link, CURRENT, 'mac')).toThrow('real directory')
    linkFixtureFile(join(outside, MAC), outside, join(directory, MAC))
    expect(() => pruneReleases(directory, CURRENT, 'mac')).toThrow('nonempty regular file')
    expect(readdirSync(outside)).toHaveLength(2)
    expect(readFileSync(join(outside, MAC), 'utf8')).toContain('fixture:')
    expect(lstatSync(join(directory, MAC)).isSymbolicLink()).toBe(true)
  })

  it('keeps old symlinks/directories and their checksum manifests without touching their targets', () => {
    const outside = fixture(['sentinel'])
    const directory = fixture([MAC, 'SHA256SUMS-v0.1.0-beta.1.txt', 'SHA256SUMS-v0.1.0-beta.2.txt'])
    const oldLink = 'Qumaa-0.1.0-beta.1-arm64.dmg'
    const oldDirectory = 'Qumaa-0.1.0-beta.2-arm64.dmg'
    linkFixtureFile(join(outside, 'sentinel'), outside, join(directory, oldLink))
    mkdirSync(join(directory, oldDirectory))
    writeFileSync(join(directory, oldDirectory, 'keep'), 'keep')
    linkFixtureFile(join(outside, 'sentinel'), outside, join(directory, 'SHA256SUMS-v0.2.0.txt'))
    expect(pruneReleases(directory, CURRENT, 'mac')).toEqual([])
    expect(lstatSync(join(directory, oldLink)).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(directory, oldDirectory, 'keep'), 'utf8')).toBe('keep')
    expect(readFileSync(join(outside, 'sentinel'), 'utf8')).toBe('fixture: sentinel')
    expect(readdirSync(directory)).toContain('SHA256SUMS-v0.1.0-beta.1.txt')
    expect(readdirSync(directory)).toContain('SHA256SUMS-v0.1.0-beta.2.txt')
  })
})
