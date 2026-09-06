#!/usr/bin/env node
/** Remove superseded local installers only after the selected platform has a replacement. */
import { lstatSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suffixes = { mac: 'arm64.dmg', win: 'Setup-x64.exe' }
const versionPattern = '[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?'
const validVersion = new RegExp(`^${versionPattern}$`)
const installerPattern = new RegExp(`^Qumaa-(${versionPattern})-(arm64\\.dmg|Setup-x64\\.exe)(\\.blockmap)?$`)
const checksumPattern = new RegExp(`^SHA256SUMS-v(${versionPattern})\\.txt$`)

function requireDirectory(directory, original) {
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The release directory must be a real directory, not a symlink.')
  if (original && (stat.dev !== original.dev || stat.ino !== original.ino)) throw new Error('The release directory changed during cleanup.')
  return stat
}

function requireReplacement(directory, currentVersion, platform) {
  const name = `Qumaa-${currentVersion}-${suffixes[platform]}`
  let stat
  try { stat = lstatSync(join(directory, name)) } catch { /* The actionable error below also covers a missing file. */ }
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size === 0) {
    throw new Error(`Keep existing releases: ${name} must exist as a nonempty regular file before cleanup.`)
  }
}

/** Exported for isolated fixtures. The CLI below always uses this repository's release directory. */
export function pruneReleases(directory, currentVersion, platform) {
  if (!Object.hasOwn(suffixes, platform)) throw new Error('Usage: node scripts/prune-releases.mjs mac|win')
  if (typeof currentVersion !== 'string' || !validVersion.test(currentVersion)) throw new Error('The package version is not a supported release version.')
  const originalDirectory = requireDirectory(directory)
  requireReplacement(directory, currentVersion, platform)
  const removed = []

  const removeRegularFile = (name) => {
    requireDirectory(directory, originalDirectory)
    requireReplacement(directory, currentVersion, platform)
    const path = join(directory, name)
    const stat = lstatSync(path)
    // unlink never recursively removes directories or follows the final symlink.
    // Skip symlinks altogether, including ones named like release artifacts.
    if (!stat.isFile() || stat.isSymbolicLink()) return
    unlinkSync(path)
    removed.push(name)
  }

  for (const name of readdirSync(directory).sort()) {
    const match = installerPattern.exec(name)
    if (match && match[1] !== currentVersion && match[2] === suffixes[platform]) removeRegularFile(name)
  }

  // Keep the shared checksum manifest while either platform's installer remains.
  // Conservatively count matching symlinks/directories as retained entries too.
  requireDirectory(directory, originalDirectory)
  const remaining = readdirSync(directory)
  const retainedVersions = new Set(remaining.flatMap((name) => {
    const match = installerPattern.exec(name)
    return match && !match[3] ? [match[1]] : []
  }))
  for (const name of remaining.sort()) {
    const match = checksumPattern.exec(name)
    if (match && match[1] !== currentVersion && !retainedVersions.has(match[1])) removeRegularFile(name)
  }
  return removed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/prune-releases.mjs mac|win')
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const removed = pruneReleases(join(root, 'release'), version, process.argv[2])
    console.log(`Pruned ${removed.length} obsolete local release file${removed.length === 1 ? '' : 's'} for ${process.argv[2]}.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
