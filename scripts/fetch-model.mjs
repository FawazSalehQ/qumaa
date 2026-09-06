#!/usr/bin/env node
/**
 * Vendors the embedding model into resources/models/ so the packaged app never
 * touches the network. Run once after clone; the output is gitignored.
 *
 * Layout must match what transformers.js expects under env.localModelPath:
 *   resources/models/<MODEL_ID>/config.json
 *   resources/models/<MODEL_ID>/tokenizer.json
 *   resources/models/<MODEL_ID>/onnx/model_quantized.onnx
 */
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertExactModelTree,
  assertModelFile,
  ModelIntegrityError
} from './model-integrity.mjs'

// Xenova's ONNX conversion of intfloat/multilingual-e5-small. The conversion
// repo declares no licence of its own; the upstream model is MIT, and those
// terms govern the weights this vendors. See THIRD-PARTY-NOTICES.md.
//
// Multilingual matters here: the app is Arabic-named and Arabic CVs are a real
// case, and the previous English-only model tokenised Arabic into meaningless
// fragments.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'scripts', 'model-manifest.json')

function validateManifest(value) {
  if (!value || value.schemaVersion !== 1) throw new Error('unsupported model manifest schema')
  if (!/^[\w.-]+\/[\w.-]+$/.test(value.repository ?? '')) {
    throw new Error('invalid model repository in manifest')
  }
  if (!/^[0-9a-f]{40}$/.test(value.revision ?? '')) {
    throw new Error('model revision must be a full 40-character commit hash')
  }
  if (!/^[\w.-]+$/.test(value.modelId ?? '')) throw new Error('invalid model ID in manifest')
  if (!Array.isArray(value.files) || value.files.length === 0) {
    throw new Error('model manifest has no files')
  }

  const seen = new Set()
  for (const file of value.files) {
    const segments = typeof file.path === 'string' ? file.path.split('/') : []
    if (
      segments.length === 0 ||
      segments.some((segment) => !segment || segment === '.' || segment === '..') ||
      seen.has(file.path)
    ) {
      throw new Error(`invalid or duplicate model path: ${String(file.path)}`)
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error(`invalid expected size for ${file.path}`)
    }
    if (!/^[0-9a-f]{64}$/.test(file.sha256 ?? '')) {
      throw new Error(`invalid SHA-256 for ${file.path}`)
    }
    seen.add(file.path)
  }

  return value
}

const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
const outDir = join(root, 'resources', 'models', manifest.modelId)

function human(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`
}

async function alreadyHave(dest, file) {
  try {
    await assertModelFile(dest, file)
    return true
  } catch (err) {
    if (err?.code === 'ENOENT') return false
    if (err instanceof ModelIntegrityError) {
      console.warn(`  ! ${file.path} is not trusted: ${err.message}`)
      return false
    }
    throw err
  }
}

async function verify(file) {
  const dest = join(outDir, file.path)
  try {
    await assertModelFile(dest, file)
    console.log(`  ✓ ${file.path}`)
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new ModelIntegrityError(`${file.path}: required model file is missing`)
    }
    throw err
  }
}

function sourceUrl(file) {
  const encodedPath = file.path.split('/').map(encodeURIComponent).join('/')
  return `https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${encodedPath}`
}

function isRetryable(err) {
  return !(err instanceof ModelIntegrityError)
}

async function removePart(part) {
  try {
    await rm(part, { force: true })
  } catch {
    // Keep the original failure; an orphaned unique .part file is never packaged
    // as a valid model file and will not be mistaken for one on the next run.
  }
}

async function replaceAtomically(part, dest) {
  try {
    await rename(part, dest)
  } catch (err) {
    // Node's rename replaces files atomically on supported local filesystems.
    // Surface any platform/filesystem exception instead of deleting the cache.
    throw err
  }
}

async function download(file, attempt = 1) {
  const MAX_ATTEMPTS = 5
  const url = sourceUrl(file)
  const dest = join(outDir, file.path)
  const part = `${dest}.part-${process.pid}-${attempt}`
  await mkdir(dirname(dest), { recursive: true })

  if (await alreadyHave(dest, file)) {
    console.log(`  ✓ ${file.path} (verified cache)`)
    return
  }

  process.stdout.write(`  ↓ ${file.path} (${human(file.size)}) ... `)
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (!res.body) throw new Error('response had no body')
    await pipeline(
      Readable.fromWeb(res.body),
      createWriteStream(part, { flags: 'wx' })
    )

    await assertModelFile(part, file)
    await replaceAtomically(part, dest)
    console.log('verified')
  } catch (err) {
    await removePart(part)
    if (!isRetryable(err)) {
      throw new Error(`integrity verification failed for ${file.path}: ${err.message}`)
    }
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(`failed after ${MAX_ATTEMPTS} attempts: ${file.path} (${err.message})`)
    }
    const backoff = 1000 * 2 ** (attempt - 1)
    console.log(`retry ${attempt}/${MAX_ATTEMPTS - 1} in ${backoff / 1000}s (${err.message})`)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, backoff))
    return download(file, attempt + 1)
  }
}

async function verifyAll() {
  console.log(
    `Verifying ${manifest.repository}@${manifest.revision} in ${outDir}`
  )
  for (const file of manifest.files) await verify(file)
  await assertExactModelTree(outDir, manifest.files)
  console.log('Model verified.')
}

async function fetchAll() {
  console.log(
    `Fetching ${manifest.repository}@${manifest.revision} -> ${outDir}`
  )
  for (const file of manifest.files) await download(file)

  await assertExactModelTree(outDir, manifest.files)

  console.log('Model ready and verified.')
}

const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--verify-only')) {
  throw new Error(`unknown argument: ${args.find((arg) => arg !== '--verify-only')}`)
}

if (args.includes('--verify-only')) {
  await verifyAll()
} else {
  await fetchAll()
}
