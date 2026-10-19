import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

import { MAX_SOURCE_FILE_BYTES } from './extraction-protocol.js'

interface FileIdentity {
  device: bigint
  inode: bigint
}

export interface ValidatedFileSource {
  canonicalPath: string
  identity: FileIdentity
}

export interface ValidatedWatchRoot {
  canonicalPath: string
  identity: FileIdentity
}

function identityOf(source: BigIntStats): FileIdentity {
  return { device: source.dev, inode: source.ino }
}

function hasIdentity(source: BigIntStats, expected: FileIdentity): boolean {
  return source.dev === expected.device && source.ino === expected.inode
}

function sourceBoundaryError(): Error {
  return new Error('Resume source is not a stable, regular, non-symbolic-link file.')
}

/** Pure containment check; the inputs must already be canonical paths. */
export function isCanonicalPathWithinRoot(
  root: string,
  candidate: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const paths = platform === 'win32' ? win32 : posix
  const canonicalRoot = paths.resolve(root)
  const remainder = paths.relative(canonicalRoot, paths.resolve(candidate))
  return remainder !== '..' && !remainder.startsWith(`..${paths.sep}`) && !paths.isAbsolute(remainder)
}

/** Resolves the selected directory once and records the directory actually watched. */
export async function canonicalizeWatchedRoot(folder: string): Promise<ValidatedWatchRoot> {
  const canonicalPath = await realpath(folder)
  const metadata = await lstat(canonicalPath, { bigint: true })
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Watched folder is not a stable directory.')
  }
  return { canonicalPath, identity: identityOf(metadata) }
}

/**
 * Validates a leaf path without following a leaf symlink, then resolves all
 * parent components and records the exact file identity for the later open.
 */
export async function validateFileSource(path: string): Promise<ValidatedFileSource> {
  const before = await lstat(path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) throw sourceBoundaryError()

  const canonicalPath = await realpath(path)
  const canonical = await lstat(canonicalPath, { bigint: true })
  if (
    !canonical.isFile() ||
    canonical.isSymbolicLink() ||
    !hasIdentity(canonical, identityOf(before))
  ) {
    throw sourceBoundaryError()
  }

  return { canonicalPath, identity: identityOf(canonical) }
}

/** Canonicalises a watcher event and proves it still belongs to the selected root. */
export async function validateWatchedFileSource(
  root: ValidatedWatchRoot,
  candidate: string
): Promise<ValidatedFileSource> {
  const rootBefore = await lstat(root.canonicalPath, { bigint: true })
  if (!rootBefore.isDirectory() || !hasIdentity(rootBefore, root.identity)) {
    throw new Error('Watched folder changed while it was active.')
  }

  // Containment is intentionally decided from real paths. The spelling
  // emitted by the OS can use an alias such as /var for canonical /private/var.
  const source = await validateFileSource(candidate)
  if (!isCanonicalPathWithinRoot(root.canonicalPath, source.canonicalPath)) {
    throw new Error('Watched file resolves outside the selected folder.')
  }

  // Detect a root replacement during candidate canonicalisation as well.
  const rootAfter = await lstat(root.canonicalPath, { bigint: true })
  if (!rootAfter.isDirectory() || !hasIdentity(rootAfter, root.identity)) {
    throw new Error('Watched folder changed while it was active.')
  }
  return source
}

/**
 * Reads only from the descriptor whose identity was validated. The lstat plus
 * descriptor identity check is required on Windows (where O_NOFOLLOW may be
 * ignored) and also catches a substituted symlink in any parent component.
 */
export async function readValidatedFileSource(source: ValidatedFileSource): Promise<Buffer> {
  const pathMetadata = await lstat(source.canonicalPath, { bigint: true })
  if (
    !pathMetadata.isFile() ||
    pathMetadata.isSymbolicLink() ||
    !hasIdentity(pathMetadata, source.identity)
  ) {
    throw sourceBoundaryError()
  }

  const optionalNoFollow = constants.O_NOFOLLOW ?? 0
  const optionalNonBlock = constants.O_NONBLOCK ?? 0
  let handle
  try {
    handle = await open(
      source.canonicalPath,
      constants.O_RDONLY | optionalNoFollow | optionalNonBlock
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw sourceBoundaryError()
    throw error
  }

  try {
    const metadata = await handle.stat({ bigint: true })
    if (!metadata.isFile() || !hasIdentity(metadata, source.identity)) {
      throw sourceBoundaryError()
    }
    if (metadata.size > BigInt(MAX_SOURCE_FILE_BYTES)) {
      throw new Error('Resume exceeds Qumaa\'s 25 MB source-file limit.')
    }

    const maximumRead = MAX_SOURCE_FILE_BYTES + 1
    const initialSize = Number(metadata.size)
    let buffer = Buffer.allocUnsafe(Math.min(maximumRead, Math.max(1, initialSize + 1)))
    let total = 0

    while (total < maximumRead) {
      if (total === buffer.byteLength) {
        const expanded = Buffer.allocUnsafe(maximumRead)
        buffer.copy(expanded, 0, 0, total)
        buffer = expanded
      }
      const { bytesRead } = await handle.read(
        buffer,
        total,
        Math.min(buffer.byteLength - total, maximumRead - total),
        null
      )
      if (bytesRead === 0) break
      total += bytesRead
    }

    if (total > MAX_SOURCE_FILE_BYTES) {
      throw new Error('Resume exceeds Qumaa\'s 25 MB source-file limit.')
    }
    return buffer.subarray(0, total)
  } finally {
    await handle.close()
  }
}
