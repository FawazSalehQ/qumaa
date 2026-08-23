#!/usr/bin/env node
/**
 * Fetches the Windows-only native package needed to cross-build from macOS.
 *
 * `sharp` splits its binaries into one package per platform, and npm refuses to
 * install a package whose `os` field does not match the host, so a plain
 * `npm install` on macOS never produces @img/sharp-win32-x64. Without it the
 * Windows build still succeeds and then dies on launch, because
 * transformers.node.cjs `require`s sharp at module load. This script closes that
 * gap and fails loudly rather than letting a broken installer ship.
 *
 * better-sqlite3 and onnxruntime-node need no equivalent: both ship every
 * platform's prebuilt binaries inside a single package.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = '@img/sharp-win32-x64'
const dest = join(root, 'node_modules', '@img', 'sharp-win32-x64')

function sharpVersion() {
  const p = join(root, 'node_modules', 'sharp', 'package.json')
  if (!existsSync(p)) throw new Error('sharp is not installed; run `npm install` first')
  return JSON.parse(readFileSync(p, 'utf8')).version
}

/** The build is only safe if the actual binary and its libvips DLLs are present. */
function verify() {
  const lib = join(dest, 'lib')
  if (!existsSync(join(lib, 'sharp-win32-x64.node'))) return false
  return readdirSync(lib).some((f) => f.endsWith('.dll'))
}

const version = sharpVersion()

if (verify()) {
  console.log(`${pkg}@${version}: already present`)
  process.exit(0)
}

const scratch = mkdtempSync(join(tmpdir(), 'cvfilter-win-'))
try {
  console.log(`Fetching ${pkg}@${version} ...`)
  execFileSync('npm', ['pack', `${pkg}@${version}`, '--silent'], {
    cwd: scratch,
    stdio: ['ignore', 'inherit', 'inherit']
  })
  const tgz = readdirSync(scratch).find((f) => f.endsWith('.tgz'))
  if (!tgz) throw new Error('npm pack produced no tarball')

  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  execFileSync('tar', ['-xzf', join(scratch, tgz), '-C', dest, '--strip-components=1'])
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

if (!verify()) {
  console.error(`\n${pkg} was fetched but has no usable binary. Refusing to build.`)
  process.exit(1)
}
console.log(`${pkg}@${version}: ready`)
