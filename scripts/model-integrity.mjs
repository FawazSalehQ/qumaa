import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export class ModelIntegrityError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ModelIntegrityError'
  }
}

/** Calculate both values in one streaming pass, including for the 113 MB ONNX file. */
export async function inspectModelFile(filePath) {
  const hash = createHash('sha256')
  let size = 0

  for await (const chunk of createReadStream(filePath)) {
    size += chunk.length
    hash.update(chunk)
  }

  return { size, sha256: hash.digest('hex') }
}

/** Fail closed when a cached or newly downloaded file differs from the manifest. */
export async function assertModelFile(filePath, expected) {
  const actual = await inspectModelFile(filePath)
  const label = expected.path ?? filePath

  if (actual.size !== expected.size) {
    throw new ModelIntegrityError(
      `${label}: size mismatch (got ${actual.size}, expected ${expected.size})`
    )
  }

  if (actual.sha256 !== expected.sha256) {
    throw new ModelIntegrityError(
      `${label}: SHA-256 mismatch (got ${actual.sha256}, expected ${expected.sha256})`
    )
  }

  return actual
}

async function modelTreeEntries(root, directory = root, entries = []) {
  const children = await readdir(directory, { withFileTypes: true })
  children.sort((left, right) => left.name.localeCompare(right.name))
  for (const child of children) {
    const absolute = join(directory, child.name)
    const portable = relative(root, absolute).split(sep).join('/')
    if (child.isDirectory()) {
      entries.push(`${portable}/`)
      await modelTreeEntries(root, absolute, entries)
    } else if (child.isFile()) {
      entries.push(portable)
    } else {
      throw new ModelIntegrityError(`${portable}: model tree contains a link or special file`)
    }
  }
  return entries
}

/** Reject anything the manifest did not name so packaging cannot pick up stale files. */
export async function assertExactModelTree(root, expectedFiles) {
  const expected = new Set()
  for (const file of expectedFiles) {
    const segments = file.path.split('/')
    for (let index = 1; index < segments.length; index++) {
      expected.add(`${segments.slice(0, index).join('/')}/`)
    }
    expected.add(file.path)
  }

  const actual = await modelTreeEntries(root)
  const unexpected = actual.filter((entry) => !expected.has(entry))
  const actualSet = new Set(actual)
  const missing = [...expected].filter((entry) => !actualSet.has(entry))
  if (unexpected.length > 0 || missing.length > 0) {
    const details = [
      unexpected.length > 0 ? `unexpected: ${unexpected.join(', ')}` : '',
      missing.length > 0 ? `missing: ${missing.join(', ')}` : ''
    ].filter(Boolean).join('; ')
    throw new ModelIntegrityError(`model directory does not match the manifest (${details})`)
  }
}
