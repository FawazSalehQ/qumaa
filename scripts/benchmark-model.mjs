#!/usr/bin/env node
/**
 * Compare a local q8 embedding model using exported evaluation inputs.
 * Never opens the application database or imports Electron. Model assets and
 * production configuration are read-only; no downloads or cache fallback.
 *
 * node scripts/benchmark-model.mjs --input case.json --model-dir /tmp/models \
 *   --model-id multilingual-e5-base --output result.json [--batch-size 8]
 *
 * Input: { provenance: {}, queries: string[], requiredSkills: string[],
 *   candidates: [{ id, file, tier, skills: string[], lexical: number,
 *     chunks: [{ section, text }] }] }
 * `lexical` is the positive raw SQLite BM25 score, before pool normalization.
 * Filenames and relevance tiers are used only for output and grading.
 * Asset hashing precedes model loading, so loadMs uses a warmed file cache; it
 * is not a fresh-disk startup measurement. queryMs is the first model forward.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { availableParallelism, cpus } from 'node:os'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TOKEN_WINDOW = 512
const SECTIONS = new Set(['experience', 'projects', 'other', 'skills', 'education', 'summary'])
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const strings = (value) => Array.isArray(value) && value.every(nonempty)
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const ms = (start) => performance.now() - start

function argumentsOf(argv) {
  const options = {}
  const supported = new Set(['--input', '--model-dir', '--model-id', '--output', '--batch-size'])
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    assert(supported.has(key) && !Object.hasOwn(options, key), `Unknown or repeated option: ${key}`)
    assert(nonempty(argv[i + 1]) && !argv[i + 1].startsWith('--'), `Missing value for ${key}`)
    options[key] = argv[i + 1]
  }
  for (const key of ['--input', '--model-dir', '--model-id', '--output']) {
    assert(nonempty(options[key]), `Required option: ${key}`)
  }
  const batchSize = Number(options['--batch-size'] ?? 8)
  assert(Number.isSafeInteger(batchSize) && batchSize > 0, '--batch-size must be a positive safe integer.')
  const modelId = options['--model-id']
  assert(modelId.split('/').every((part) => /^[A-Za-z0-9._-]+$/.test(part) && part !== '.' && part !== '..'),
    '--model-id must be a relative model subdirectory, not a URL or traversal path.')
  return {
    inputPath: resolve(options['--input']), outputPath: resolve(options['--output']),
    modelRoot: resolve(options['--model-dir']), modelId, batchSize
  }
}

function validateInput(input) {
  assert(record(input) && record(input.provenance), 'Input must contain a provenance object.')
  assert(strings(input.queries) && input.queries.length > 0, 'Input queries must be nonempty strings.')
  assert(strings(input.requiredSkills), 'Input requiredSkills must be an array of nonempty strings.')
  assert(Array.isArray(input.candidates) && input.candidates.length > 0, 'Input must contain candidates.')
  const ids = new Set()
  const files = new Set()
  for (const [index, candidate] of input.candidates.entries()) {
    const at = `Candidate ${index + 1}`
    assert(record(candidate), `${at} must be an object.`)
    assert(Number.isSafeInteger(candidate.id) && candidate.id > 0 && !ids.has(candidate.id), `${at} has an invalid or duplicate id.`)
    assert(nonempty(candidate.file) && !files.has(candidate.file), `${at} has an invalid or duplicate file.`)
    assert(Number.isInteger(candidate.tier) && candidate.tier >= 1 && candidate.tier <= 4, `${at} tier must be 1–4.`)
    assert(strings(candidate.skills), `${at} skills must be an array of nonempty strings.`)
    assert(Number.isFinite(candidate.lexical) && candidate.lexical >= 0, `${at} lexical must be a nonnegative raw score.`)
    assert(Array.isArray(candidate.chunks) && candidate.chunks.length > 0, `${at} must contain searchable chunks.`)
    for (const chunk of candidate.chunks) {
      assert(record(chunk) && SECTIONS.has(chunk.section) && nonempty(chunk.text), `${at} contains an invalid chunk.`)
    }
    ids.add(candidate.id)
    files.add(candidate.file)
  }
  assert(input.candidates.some((candidate) => candidate.tier === 1), 'Input requires a tier-1 candidate for evaluation.')
}

function within(parent, child) {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

async function modelInventory(modelPath) {
  const files = []
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name)
      assert(!entry.isSymbolicLink(), `Model assets must not contain symbolic links: ${path}`)
      if (entry.isDirectory()) await visit(path)
      else {
        assert(entry.isFile(), `Unsupported model asset: ${path}`)
        const digest = createHash('sha256')
        for await (const data of createReadStream(path)) digest.update(data)
        files.push({ file: relative(modelPath, path).split(sep).join('/'), bytes: (await stat(path)).size, sha256: digest.digest('hex') })
      }
    }
  }
  await visit(modelPath)
  for (const required of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']) {
    assert(files.some((file) => file.file === required && file.bytes > 0), `Missing or empty local model asset: ${required}`)
  }
  return files
}

async function productionScoring() {
  const result = await build({
    stdin: {
      contents: [
        "export { QUERY_PREFIX, PASSAGE_PREFIX } from './src/main/embed/protocol.ts';",
        "export { scoreSemantics, skillOverlap, normalizeScores, blend, WEIGHTS } from './src/main/search/scoring.ts';",
        "export { rankingMetrics } from './src/main/eval-support.ts';"
      ].join('\n'),
      resolveDir: ROOT, sourcefile: 'benchmark-scoring-entry.ts', loader: 'ts'
    },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
    metafile: true, logLevel: 'silent'
  })
  // Guard future import changes: the benchmark must stay independent of native
  // app modules, even if an ostensibly pure helper acquires a new dependency.
  assert(Object.keys(result.metafile.inputs).every((path) => !/node_modules|(?:^|\/)db\/|embed\/(?:client|worker)\./.test(path)),
    'Production scoring bundle unexpectedly includes an application runtime dependency.')
  assert(result.metafile.outputs && result.outputFiles.length === 1, 'Expected one in-memory scoring bundle.')
  const bundle = result.outputFiles[0].contents
  const scoring = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`)
  return { scoring, scoringBundleSha256: sha256(bundle) }
}

async function main() {
  const started = performance.now()
  assert(Number(process.versions.node.split('.')[0]) >= 22, 'Node 22 or newer is required.')
  const options = argumentsOf(process.argv.slice(2))
  const inputBytes = await readFile(options.inputPath)
  const input = JSON.parse(inputBytes.toString('utf8'))
  validateInput(input)
  assert(options.inputPath !== options.outputPath, '--output must not overwrite --input.')
  const inputPath = await realpath(options.inputPath)
  const modelRoot = await realpath(options.modelRoot)
  const modelPath = await realpath(resolve(modelRoot, options.modelId))
  assert(within(modelRoot, modelPath), 'Model directory must remain within --model-dir.')
  assert(!within(modelRoot, options.outputPath), '--output must be outside the model asset directory.')
  async function checkOutputPath() {
    const outputPath = resolve(await realpath(dirname(options.outputPath)), options.outputPath.split(sep).at(-1))
    assert(outputPath !== inputPath, '--output must not overwrite --input through a path alias.')
    assert(!within(modelRoot, outputPath), '--output resolves inside the model asset directory.')
    return outputPath
  }
  // Reject aliases before expensive inference when the output parent exists.
  // A new parent is checked again after it is created, immediately before write.
  await checkOutputPath().catch((error) => { if (error.code !== 'ENOENT') throw error })
  const modelFiles = await modelInventory(modelPath)
  const { scoring, scoringBundleSha256 } = await productionScoring()
  const { QUERY_PREFIX, PASSAGE_PREFIX, scoreSemantics, skillOverlap, normalizeScores, blend, rankingMetrics, WEIGHTS } = scoring
  const { env, pipeline } = await import('@huggingface/transformers')
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = modelRoot + sep
  env.useFSCache = false
  env.useBrowserCache = false
  env.useCustomCache = false

  let peakRssBytes = process.memoryUsage().rss
  const sampleRss = () => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss) }
  const rssSampler = setInterval(sampleRss, 25)
  rssSampler.unref()
  let extractor
  let temporaryOutput
  try {
    console.log(`Loading ${options.modelId} locally (q8, CPU; batch size ${options.batchSize})…`)
    const loading = performance.now()
    extractor = await pipeline('feature-extraction', options.modelId, { dtype: 'q8', device: 'cpu', local_files_only: true })
    const loadMs = ms(loading)
    sampleRss()
    assert(extractor.tokenizer.model_max_length === TOKEN_WINDOW,
      `Model tokenizer window must equal production's ${TOKEN_WINDOW} tokens; found ${extractor.tokenizer.model_max_length}.`)

    let dimension
    const tokenization = {
      maxTokens: TOKEN_WINDOW, queriesTruncated: 0, passagesTruncated: 0,
      longestQueryTokens: 0, longestPassageTokens: 0
    }
    async function embed(texts, kind, countTokens = true) {
      const vectors = []
      const prefix = kind === 'queries' ? QUERY_PREFIX : PASSAGE_PREFIX
      for (let offset = 0; offset < texts.length; offset += options.batchSize) {
        const batch = texts.slice(offset, offset + options.batchSize).map((text) => prefix + text)
        if (countTokens) {
          const untruncated = extractor.tokenizer(batch, { truncation: false, padding: false, return_tensor: false }).input_ids
          assert(Array.isArray(untruncated) && untruncated.length === batch.length, 'Tokenizer returned invalid token counts.')
          for (const ids of untruncated) {
            assert(Array.isArray(ids) && ids.length > 0, 'Tokenizer returned an empty or malformed sequence.')
            const maximum = kind === 'queries' ? 'longestQueryTokens' : 'longestPassageTokens'
            const truncated = kind === 'queries' ? 'queriesTruncated' : 'passagesTruncated'
            tokenization[maximum] = Math.max(tokenization[maximum], ids.length)
            if (ids.length > TOKEN_WINDOW) tokenization[truncated]++
          }
        }
        const output = await extractor(batch, { pooling: 'mean', normalize: true })
        try {
          const shape = output?.dims
          assert(Array.isArray(shape) && shape.length === 2 && shape[0] === batch.length && Number.isSafeInteger(shape[1]) && shape[1] > 0,
            'Model returned an invalid embedding shape.')
          dimension ??= shape[1]
          assert(shape[1] === dimension && output.data?.length === batch.length * dimension, 'Model returned missing or inconsistent embedding dimensions.')
          for (let i = 0; i < batch.length; i++) {
            const vector = Float32Array.from(output.data.slice(i * dimension, (i + 1) * dimension))
            let norm = 0
            for (const value of vector) {
              assert(Number.isFinite(value), 'Model returned a non-finite embedding value.')
              norm += value * value
            }
            assert(Math.abs(norm - 1) < 0.005, 'Model returned an empty or non-normalized embedding.')
            vectors.push(vector)
          }
        } finally {
          output?.dispose?.()
        }
        sampleRss()
      }
      return vectors
    }

    const querying = performance.now()
    const queryVectors = await embed(input.queries, 'queries')
    const queryMs = ms(querying)
    console.log(`Embedded ${queryVectors.length} queries; scoring ${input.candidates.length} candidates…`)
    const raws = []
    let passagesMs = 0
    let scoringMs = 0
    let passageCount = 0
    for (const [index, candidate] of input.candidates.entries()) {
      const embedding = performance.now()
      const vectors = await embed(candidate.chunks.map((chunk) => chunk.text), 'passages')
      passagesMs += ms(embedding)
      passageCount += vectors.length
      const scoringStarted = performance.now()
      const { semantic, evidence } = scoreSemantics(queryVectors,
        candidate.chunks.map((chunk, i) => ({ ...chunk, vector: vectors[i] })))
      const skills = skillOverlap(input.requiredSkills, new Set(candidate.skills))
      assert(Number.isFinite(semantic) && Number.isFinite(skills), 'Production scoring returned a non-finite component.')
      raws.push({ id: candidate.id, file: candidate.file, tier: candidate.tier, semantic, lexical: candidate.lexical, skills, evidence })
      scoringMs += ms(scoringStarted)
      if ((index + 1) % 10 === 0 || index + 1 === input.candidates.length) {
        console.log(`Scored ${index + 1}/${input.candidates.length} candidates (${passageCount} passages).`)
      }
    }
    const warmQueryMs = []
    let warmQueryMaxVectorDelta = 0
    for (let repetition = 0; repetition < 3; repetition++) {
      const querying = performance.now()
      const warmedVectors = await embed(input.queries, 'queries', false)
      warmQueryMs.push(ms(querying))
      for (let i = 0; i < queryVectors.length; i++) {
        for (let j = 0; j < queryVectors[i].length; j++) {
          warmQueryMaxVectorDelta = Math.max(warmQueryMaxVectorDelta, Math.abs(queryVectors[i][j] - warmedVectors[i][j]))
        }
      }
    }
    const warmQueryMedianMs = [...warmQueryMs].sort((a, b) => a - b)[1]
    console.log(`Warm query median ${warmQueryMedianMs.toFixed(0)} ms across ${warmQueryMs.length} serial repetitions.`)
    if (warmQueryMaxVectorDelta > 1e-5) {
      console.log(`Warm query vectors differ from the first forward by up to ${warmQueryMaxVectorDelta}; recorded for numerical comparison.`)
    }
    const scoringStarted = performance.now()
    const semanticN = normalizeScores(raws.map((candidate) => candidate.semantic))
    const lexicalN = normalizeScores(raws.map((candidate) => candidate.lexical))
    const ranking = raws.map((candidate, i) => ({
      id: candidate.id, file: candidate.file, tier: candidate.tier,
      score: blend(semanticN[i], lexicalN[i], candidate.skills),
      breakdown: { semantic: semanticN[i], lexical: lexicalN[i], skills: candidate.skills },
      raw: { semantic: candidate.semantic, lexical: candidate.lexical }, evidence: candidate.evidence
    })).sort((a, b) => b.score - a.score).map((candidate, i) => ({ rank: i + 1, ...candidate }))
    assert(ranking.every((candidate) => Number.isFinite(candidate.score)), 'Production scoring returned an invalid final score.')
    const metrics = rankingMetrics(ranking.map((candidate) => candidate.tier), input.candidates.map((candidate) => candidate.tier))
    scoringMs += ms(scoringStarted)
    sampleRss()
    const result = {
      schemaVersion: 1, createdAt: new Date().toISOString(), modelId: options.modelId,
      runtime: {
        node: process.version, transformers: env.version, platform: process.platform, arch: process.arch,
        cpu: cpus()[0]?.model ?? null, availableParallelism: availableParallelism(), device: 'cpu', dtype: 'q8',
        batchSize: options.batchSize, embeddingDimension: dimension, queryPrefix: QUERY_PREFIX, passagePrefix: PASSAGE_PREFIX
      },
      loadMs, loadFileCache: 'warmed-by-asset-hashing', passagesMs, queryMs,
      warmQueryMs, warmQueryMedianMs, warmQueryMaxVectorDelta,
      warmQueryWithinTolerance: warmQueryMaxVectorDelta <= 1e-5,
      scoringMs, totalMs: ms(started),
      passageCount, candidateCount: input.candidates.length, queryCount: input.queries.length,
      modelBytes: modelFiles.reduce((sum, file) => sum + file.bytes, 0),
      peakRssBytes, rssSamplingIntervalMs: 25, tokenization, weights: WEIGHTS,
      provenance: {
        input: input.provenance, inputSha256: sha256(inputBytes), scoringBundleSha256,
        modelFiles, modelFilesSha256: sha256(JSON.stringify(modelFiles)),
        benchmarkScriptSha256: sha256(await readFile(fileURLToPath(import.meta.url)))
      },
      metrics, ranking
    }
    await mkdir(dirname(options.outputPath), { recursive: true })
    const outputPath = await checkOutputPath()
    temporaryOutput = `${outputPath}.tmp-${process.pid}`
    await writeFile(temporaryOutput, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    await rename(temporaryOutput, outputPath)
    temporaryOutput = undefined
    console.log(`Recall@10 ${(metrics.recallAt10 * 100).toFixed(1)}%; precision@3 ${(metrics.precisionAt3 * 100).toFixed(1)}%; saved ${options.outputPath}`)
    if (tokenization.queriesTruncated || tokenization.passagesTruncated) {
      console.log(`Production ${TOKEN_WINDOW}-token truncation affected ${tokenization.queriesTruncated} queries and ${tokenization.passagesTruncated} passages; counts are in the result.`)
    }
  } finally {
    clearInterval(rssSampler)
    if (temporaryOutput) await unlink(temporaryOutput).catch(() => {})
    await extractor?.dispose()
  }
}

main().catch((error) => {
  console.error(`Model benchmark failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
