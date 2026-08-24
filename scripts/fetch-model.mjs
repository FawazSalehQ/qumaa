#!/usr/bin/env node
/**
 * Vendors the embedding model into resources/models/ so the packaged app never
 * touches the network. Run once after clone; the output is gitignored.
 *
 * Layout must match what transformers.js expects under env.localModelPath:
 *   resources/models/<MODEL_ID>/config.json
 *   resources/models/<MODEL_ID>/tokenizer.json
 *   resources/models/<MODEL_ID>/onnx/model.onnx
 */
import { mkdir, stat, rename, rm, readdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Xenova's ONNX conversion of intfloat/multilingual-e5-small. The conversion
// repo declares no licence of its own; the upstream model is MIT, and those
// terms govern the weights this vendors. See THIRD-PARTY-NOTICES.md.
//
// Multilingual matters here: the app is Arabic-named and Arabic CVs are a real
// case, and the previous English-only model tokenised Arabic into meaningless
// fragments.
const REPO = 'Xenova/multilingual-e5-small'
const MODEL_ID = 'multilingual-e5-small'

// int8 weights. The multilingual vocabulary is 250k tokens, which makes fp32
// 470MB; quantised is 113MB and measurably still ranks Arabic and English
// correctly, including cross-lingual. fp16 is not an option: onnxruntime-node
// cannot load it on CPU.
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx'
]

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'models', MODEL_ID)

function human(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`
}

async function alreadyHave(dest, remoteSize) {
  try {
    const s = await stat(dest)
    return remoteSize ? s.size === remoteSize : s.size > 0
  } catch {
    return false
  }
}

/** Streams to a .part file then renames, so an interrupted run never leaves a
 *  truncated model that looks valid to the cache check. Retries on reset. */
async function download(file, attempt = 1) {
  const MAX_ATTEMPTS = 5
  const url = `https://huggingface.co/${REPO}/resolve/main/${file}`
  const dest = join(outDir, file)
  const part = `${dest}.part`
  await mkdir(dirname(dest), { recursive: true })

  let remoteSize = 0
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    remoteSize = Number(head.headers.get('content-length')) || 0
  } catch {
    /* HEAD is only an optimisation; fall through to the GET */
  }

  if (await alreadyHave(dest, remoteSize)) {
    console.log(`  ✓ ${file} (cached)`)
    return
  }

  process.stdout.write(`  ↓ ${file}${remoteSize ? ` (${human(remoteSize)})` : ''} ... `)
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body), createWriteStream(part))

    const written = (await stat(part)).size
    if (remoteSize && written !== remoteSize) {
      throw new Error(`size mismatch: got ${written}, expected ${remoteSize}`)
    }
    await rename(part, dest)
    console.log('done')
  } catch (err) {
    await rm(part, { force: true })
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(`failed after ${MAX_ATTEMPTS} attempts: ${file} (${err.message})`)
    }
    const backoff = 1000 * 2 ** (attempt - 1)
    console.log(`retry ${attempt}/${MAX_ATTEMPTS - 1} in ${backoff / 1000}s (${err.message})`)
    await new Promise((r) => setTimeout(r, backoff))
    return download(file, attempt + 1)
  }
}

console.log(`Fetching ${REPO} -> ${outDir}`)
for (const f of FILES) await download(f)

// Remove any previously vendored model. extraResources copies the whole models
// directory, so a leftover would silently double the installer size.
const modelsRoot = join(root, 'resources', 'models')
for (const entry of await readdir(modelsRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== MODEL_ID) {
    await rm(join(modelsRoot, entry.name), { recursive: true, force: true })
    console.log(`  removed stale model: ${entry.name}`)
  }
}

console.log('Model ready.')
