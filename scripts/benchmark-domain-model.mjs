#!/usr/bin/env node
/**
 * Multi-case, strictly offline q8 model comparison against frozen SQLite exports.
 * Each distinct query and passage is embedded once per run, in deterministic
 * first-seen order across sorted case files. No labels or filenames enter the
 * model or scorer; they are used only for grouping, output and evaluation.
 *
 * node scripts/benchmark-domain-model.mjs --input-dir exported-cases \
 *   --model-dir resources/models --model-id multilingual-e5-small \
 *   --output eval/results/model.json [--batch-size 8]
 *
 * Case names: family--vacancy--cohort--language.json. Input objects use the
 * modelBenchmarkInput export contract, with provenance, queries, requiredSkills
 * and candidates {id,file,tier,skills,lexical,chunks:[{section,text}]}.
 * This is a quality/cost comparison, not an app latency or capacity benchmark.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { link, lstat, mkdir, open, readFile, readdir, realpath, stat, unlink } from 'node:fs/promises'
import { availableParallelism, cpus } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TOKEN_WINDOW = 512
const SECTIONS = new Set(['experience', 'projects', 'other', 'skills', 'education', 'summary'])
const COHORTS = new Set(['mixed-a', 'mixed-b', 'english', 'arabic'])
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const strings = (value) => Array.isArray(value) && value.every(nonempty)
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const ms = (start) => performance.now() - start
const alphabetical = (a, b) => a < b ? -1 : a > b ? 1 : 0

function argumentsOf(argv) {
  const options = {}
  const supported = new Set(['--input-dir', '--model-dir', '--model-id', '--output', '--batch-size'])
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    assert(supported.has(key) && !Object.hasOwn(options, key), `Unknown or repeated option: ${key}`)
    assert(nonempty(argv[i + 1]) && !argv[i + 1].startsWith('--'), `Missing value for ${key}`)
    options[key] = argv[i + 1]
  }
  for (const key of ['--input-dir', '--model-dir', '--model-id', '--output']) assert(nonempty(options[key]), `Required option: ${key}`)
  const batchSize = Number(options['--batch-size'] ?? 8)
  assert(Number.isSafeInteger(batchSize) && batchSize >= 1 && batchSize <= 32, '--batch-size must be an integer from 1 to 32.')
  const modelId = options['--model-id']
  assert(modelId.split('/').every((part) => /^[A-Za-z0-9._-]+$/.test(part) && part !== '.' && part !== '..'),
    '--model-id must be a relative model subdirectory, not a URL or traversal path.')
  return { inputRoot: resolve(options['--input-dir']), outputPath: resolve(options['--output']),
    modelRoot: resolve(options['--model-dir']), modelId, batchSize }
}

function validateInput(input, file) {
  const prefix = `${file}: `
  assert(record(input) && record(input.provenance), prefix + 'Input must contain a provenance object.')
  assert(strings(input.queries) && input.queries.length > 0, prefix + 'queries must be nonempty strings.')
  assert(strings(input.requiredSkills), prefix + 'requiredSkills must be an array of nonempty strings.')
  assert(new Set(input.requiredSkills).size === input.requiredSkills.length, prefix + 'Duplicate required skill.')
  assert(Array.isArray(input.candidates) && input.candidates.length >= 3, prefix + 'At least three candidates are required.')
  const ids = new Set()
  const files = new Set()
  for (const [index, candidate] of input.candidates.entries()) {
    const at = `${prefix}candidate ${index + 1}`
    assert(record(candidate), `${at} must be an object.`)
    assert(Number.isSafeInteger(candidate.id) && candidate.id > 0 && !ids.has(candidate.id), `${at} has an invalid or duplicate id.`)
    assert(nonempty(candidate.file) && !files.has(candidate.file), `${at} has an invalid or duplicate file.`)
    assert(Number.isInteger(candidate.tier) && candidate.tier >= 1 && candidate.tier <= 4, `${at} tier must be 1–4.`)
    assert(strings(candidate.skills) && new Set(candidate.skills).size === candidate.skills.length, `${at} skills must be unique nonempty strings.`)
    assert(Number.isFinite(candidate.lexical) && candidate.lexical >= 0, `${at} lexical must be a nonnegative raw score.`)
    assert(Array.isArray(candidate.chunks) && candidate.chunks.length > 0, `${at} must contain searchable chunks.`)
    for (const chunk of candidate.chunks) assert(record(chunk) && SECTIONS.has(chunk.section) && nonempty(chunk.text), `${at} contains an invalid chunk.`)
    ids.add(candidate.id)
    files.add(candidate.file)
  }
  assert(input.candidates.some((candidate) => candidate.tier === 1), prefix + 'A tier-1 reference candidate is required.')
}

function caseMetadata(file) {
  const parts = file.slice(0, -5).split('--')
  assert(parts.length === 4, `Invalid case filename: ${file}; expected family--vacancy--cohort--language.json.`)
  const [family, vacancy, cohort, language] = parts
  assert([family, vacancy].every((part) => /^[a-z][a-z0-9-]*$/.test(part)) && COHORTS.has(cohort) && ['en', 'ar'].includes(language), `Invalid case identity: ${file}`)
  return { id: parts.join('/'), family, vacancy, cohort, language }
}

function candidateIdentity(file) {
  const match = /^([a-z][a-z0-9-]*)\/C(\d+)$/.exec(file)
  assert(match && Number.isSafeInteger(Number(match[2])) && Number(match[2]) > 0,
    `Candidate file must identify its frozen career as family/C01: ${file}`)
  return { family: match[1], ordinal: Number(match[2]) }
}

function candidateLanguage(file, cohort) {
  if (cohort === 'english') return 'en'
  if (cohort === 'arabic') return 'ar'
  const { ordinal } = candidateIdentity(file)
  return (ordinal % 2 === 1) === (cohort === 'mixed-a') ? 'en' : 'ar'
}

function languageHits(ranking, postingLanguage) {
  return Object.fromEntries(['same', 'cross'].map((relation) => {
    const relevant = (candidate) => candidate.tier === 1 && (candidate.cvLanguage === postingLanguage) === (relation === 'same')
    return [relation, { relevant: ranking.filter(relevant).length,
      hits3: ranking.slice(0, 3).filter(relevant).length, hits10: ranking.slice(0, 10).filter(relevant).length }]
  }))
}

function pooledLanguageRecall(cases) {
  return Object.fromEntries(['same', 'cross'].map((relation) => {
    const totals = Object.fromEntries(['relevant', 'hits3', 'hits10'].map((key) => [key, cases.reduce((sum, item) => sum + item.languageHits[relation][key], 0)]))
    return [relation, { ...totals, recallAt3: totals.relevant ? totals.hits3 / totals.relevant : null,
      recallAt10: totals.relevant ? totals.hits10 / totals.relevant : null }]
  }))
}

function within(parent, child) {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

/** Resolve aliases in every existing ancestor, even when the final parent is new. */
async function canonicalFuturePath(path) {
  let current = resolve(path)
  const tail = []
  while (true) {
    try { return resolve(await realpath(current), ...tail.reverse()) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      const parent = dirname(current)
      assert(parent !== current, `Cannot resolve output path: ${path}`)
      // A dangling symlink must not be mistaken for a new ordinary directory.
      const entry = await lstat(current).catch((failure) => { if (failure.code !== 'ENOENT') throw failure; return null })
      assert(!entry?.isSymbolicLink(), `Output path contains a dangling symbolic link: ${current}`)
      tail.push(basename(current))
      current = parent
    }
  }
}

async function inventory(directory) {
  const files = []
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => alphabetical(a.name, b.name))) {
      const child = resolve(path, entry.name)
      assert(!entry.isSymbolicLink(), `Model assets must not contain symbolic links: ${child}`)
      if (entry.isDirectory()) await visit(child)
      else {
        assert(entry.isFile(), `Unsupported model asset: ${child}`)
        const digest = createHash('sha256')
        for await (const data of createReadStream(child)) digest.update(data)
        files.push({ file: relative(directory, child).split(sep).join('/'), bytes: (await stat(child)).size, sha256: digest.digest('hex') })
      }
    }
  }
  await visit(directory)
  for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']) {
    assert(files.some((entry) => entry.file === file && entry.bytes > 0), `Missing or empty local model asset: ${file}`)
  }
  return files
}

async function productionScoring() {
  const result = await build({
    stdin: { contents: [
      "export { QUERY_PREFIX, PASSAGE_PREFIX } from './src/main/embed/protocol.ts';",
      "export { scoreSemantics, skillOverlap, normalizeScores, blend, WEIGHTS } from './src/main/search/scoring.ts';",
      "export { rankingMetrics } from './src/main/eval-support.ts';"
    ].join('\n'), resolveDir: ROOT, sourcefile: 'domain-benchmark-scoring-entry.ts', loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', metafile: true, logLevel: 'silent'
  })
  assert(Object.keys(result.metafile.inputs).every((path) => !/node_modules|(?:^|\/)db\/|embed\/(?:client|worker)\./.test(path)),
    'Production scoring bundle unexpectedly includes an application runtime dependency.')
  assert(Object.values(result.metafile.outputs).every((output) => output.imports.every((item) => item.path.startsWith('node:'))),
    'Production scoring has an unexpected external dependency.')
  assert(result.outputFiles.length === 1, 'Expected one in-memory scoring bundle.')
  const bundle = result.outputFiles[0].contents
  return { scoring: await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`), scoringBundleSha256: sha256(bundle) }
}

function meanMetrics(items) {
  assert(items.length > 0, 'Cannot aggregate empty cases.')
  return Object.fromEntries(Object.keys(items[0].metrics).map((key) => [key, items.reduce((sum, item) => sum + item.metrics[key], 0) / items.length]))
}

async function main() {
  const started = performance.now()
  assert(Number(process.versions.node.split('.')[0]) >= 22, 'Node 22 or newer is required.')
  const options = argumentsOf(process.argv.slice(2))
  const inputRoot = await realpath(options.inputRoot)
  const modelRoot = await realpath(options.modelRoot)
  const modelPath = await realpath(resolve(modelRoot, options.modelId))
  assert(within(modelRoot, modelPath), 'Model directory must remain within --model-dir.')
  const inputFiles = (await readdir(inputRoot, { withFileTypes: true })).filter((entry) => entry.name.endsWith('.json')).sort((a, b) => alphabetical(a.name, b.name))
  assert(inputFiles.length > 0, 'Input directory contains no JSON cases.')
  const cases = []
  const caseIds = new Set()
  for (const entry of inputFiles) {
    assert(entry.isFile() && !entry.isSymbolicLink(), `Input cases must be regular files: ${entry.name}`)
    const metadata = caseMetadata(entry.name)
    assert(!caseIds.has(metadata.id), 'Duplicate case identity.')
    caseIds.add(metadata.id)
    const bytes = await readFile(resolve(inputRoot, entry.name))
    const input = JSON.parse(bytes.toString('utf8'))
    validateInput(input, entry.name)
    assert(record(input.provenance.case) && Object.entries(metadata).every(([key, value]) => input.provenance.case[key] === value),
      `${entry.name}: provenance.case does not match the case filename.`)
    const careerOrdinals = new Map()
    for (const candidate of input.candidates) {
      const identity = candidateIdentity(candidate.file)
      const ordinals = careerOrdinals.get(identity.family) ?? []
      ordinals.push(identity.ordinal)
      careerOrdinals.set(identity.family, ordinals)
    }
    for (const [family, ordinals] of careerOrdinals) {
      assert(ordinals.every((ordinal, index) => ordinal === index + 1), `${entry.name}: ${family} careers must retain contiguous original C01… order for language attribution.`)
    }
    cases.push({ ...metadata, input, file: entry.name, sha256: sha256(bytes) })
  }
  // Equal-case aggregation is also equal-vacancy aggregation only with a full,
  // identical language/cohort grid. Refuse incomplete exports before inference.
  const byVacancy = new Map()
  const postingInputs = new Map()
  const careerInputs = new Map()
  let candidateFiles
  for (const item of cases) {
    const signature = JSON.stringify(item.input.candidates.map((candidate) => candidate.file).sort(alphabetical))
    candidateFiles ??= signature
    assert(signature === candidateFiles, `${item.file}: Candidate identities differ from the frozen pool.`)
    const postingKey = `${item.family}/${item.vacancy}/${item.language}`
    const postingInput = sha256(JSON.stringify({ queries: item.input.queries, requiredSkills: item.input.requiredSkills }))
    assert(!postingInputs.has(postingKey) || postingInputs.get(postingKey) === postingInput,
      `${item.file}: Posting queries or skills differ across cohorts.`)
    postingInputs.set(postingKey, postingInput)
    for (const candidate of item.input.candidates) {
      const careerKey = `${item.cohort}/${candidate.file}`
      const careerInput = sha256(JSON.stringify({ skills: candidate.skills, chunks: candidate.chunks }))
      assert(!careerInputs.has(careerKey) || careerInputs.get(careerKey) === careerInput,
        `${item.file}: Career ${candidate.file} skills or chunks differ within the same cohort.`)
      careerInputs.set(careerKey, careerInput)
    }
    const key = `${item.family}/${item.vacancy}`
    const group = byVacancy.get(key) ?? []
    group.push(item)
    byVacancy.set(key, group)
  }
  let grid
  for (const [key, group] of byVacancy) {
    const cells = group.map((item) => `${item.cohort}/${item.language}`).sort(alphabetical)
    grid ??= JSON.stringify(cells)
    assert(JSON.stringify(cells) === grid, `${key}: Incomplete or unequal language/cohort grid.`)
    for (const cohort of new Set(group.map((item) => item.cohort))) {
      assert(group.some((item) => item.cohort === cohort && item.language === 'en') && group.some((item) => item.cohort === cohort && item.language === 'ar'), `${key}: Both posting languages are required in every cohort.`)
    }
    const labels = (item) => JSON.stringify(item.input.candidates.map((candidate) => [candidate.file, candidate.tier]).sort((a, b) => alphabetical(a[0], b[0])))
    assert(group.every((item) => labels(item) === labels(group[0])), `${key}: Labels differ across translated/cohort variants.`)
  }
  async function checkOutputPath() {
    const output = await canonicalFuturePath(options.outputPath)
    assert(!within(inputRoot, output), '--output must be outside the input case directory, including aliases.')
    assert(!within(modelRoot, output), '--output must be outside the model asset directory, including aliases.')
    const existing = await lstat(output).catch((error) => { if (error.code !== 'ENOENT') throw error; return null })
    assert(!existing, '--output already exists; choose a new result file.')
    return output
  }
  await checkOutputPath()
  const modelFiles = await inventory(modelPath)
  const { scoring, scoringBundleSha256 } = await productionScoring()
  const { QUERY_PREFIX, PASSAGE_PREFIX, scoreSemantics, skillOverlap, normalizeScores, blend, rankingMetrics, WEIGHTS } = scoring
  const queryTexts = [...new Set(cases.flatMap((item) => item.input.queries))]
  const passageTexts = [...new Set(cases.flatMap((item) => item.input.candidates.flatMap((candidate) => candidate.chunks.map((chunk) => chunk.text))))]
  const queryReferences = cases.reduce((sum, item) => sum + item.input.queries.length, 0)
  const passageReferences = cases.reduce((sum, item) => sum + item.input.candidates.reduce((count, candidate) => count + candidate.chunks.length, 0), 0)
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
    console.log(`Loading ${options.modelId} locally (q8 CPU; ${cases.length} cases, batch ${options.batchSize})…`)
    const loading = performance.now()
    extractor = await pipeline('feature-extraction', options.modelId, { dtype: 'q8', device: 'cpu', local_files_only: true })
    const loadMs = ms(loading)
    sampleRss()
    assert(extractor.tokenizer.model_max_length === TOKEN_WINDOW, `Tokenizer window must equal production's ${TOKEN_WINDOW} tokens.`)
    let dimension
    const tokenization = { maxTokens: TOKEN_WINDOW, queriesTruncated: 0, passagesTruncated: 0, longestQueryTokens: 0, longestPassageTokens: 0 }
    const batches = { queries: [], passages: [] }
    async function embedDistinct(texts, kind) {
      const cache = new Map()
      const prefix = kind === 'queries' ? QUERY_PREFIX : PASSAGE_PREFIX
      for (let offset = 0; offset < texts.length; offset += options.batchSize) {
        const selected = texts.slice(offset, offset + options.batchSize)
        const batch = selected.map((text) => prefix + text)
        const batchStarted = performance.now()
        const untruncated = extractor.tokenizer(batch, { truncation: false, padding: false, return_tensor: false }).input_ids
        assert(Array.isArray(untruncated) && untruncated.length === batch.length, 'Tokenizer returned invalid token counts.')
        for (const ids of untruncated) {
          assert(Array.isArray(ids) && ids.length > 0, 'Tokenizer returned an invalid sequence.')
          const longest = kind === 'queries' ? 'longestQueryTokens' : 'longestPassageTokens'
          const truncated = kind === 'queries' ? 'queriesTruncated' : 'passagesTruncated'
          tokenization[longest] = Math.max(tokenization[longest], ids.length)
          if (ids.length > TOKEN_WINDOW) tokenization[truncated]++
        }
        const output = await extractor(batch, { pooling: 'mean', normalize: true })
        try {
          const shape = output?.dims
          assert(Array.isArray(shape) && shape.length === 2 && shape[0] === batch.length && Number.isSafeInteger(shape[1]) && shape[1] > 0, 'Invalid embedding shape.')
          dimension ??= shape[1]
          assert(shape[1] === dimension && output.data?.length === batch.length * dimension, 'Missing or inconsistent embedding dimensions.')
          for (let i = 0; i < batch.length; i++) {
            const vector = Float32Array.from(output.data.slice(i * dimension, (i + 1) * dimension))
            let norm = 0
            for (const value of vector) { assert(Number.isFinite(value), 'Non-finite embedding.'); norm += value * value }
            assert(Math.abs(norm - 1) < .005, 'Empty or non-normalized embedding.')
            cache.set(selected[i], vector)
          }
        } finally { output?.dispose?.() }
        batches[kind].push({ offset, count: batch.length, elapsedMs: ms(batchStarted) })
        sampleRss()
        if ((offset / options.batchSize + 1) % 20 === 0 || offset + batch.length === texts.length) console.log(`${kind}: ${offset + batch.length}/${texts.length} unique texts.`)
      }
      assert(cache.size === texts.length, 'Embedding cache is incomplete.')
      return cache
    }
    const queryStart = performance.now()
    const queryCache = await embedDistinct(queryTexts, 'queries')
    const queryMs = ms(queryStart)
    const passageStart = performance.now()
    const passageCache = await embedDistinct(passageTexts, 'passages')
    const passagesMs = ms(passageStart)
    const scoringStart = performance.now()
    const results = []
    for (const item of cases) {
      const caseStarted = performance.now()
      const queryVectors = item.input.queries.map((text) => queryCache.get(text))
      const raws = item.input.candidates.map((candidate) => {
        const chunks = candidate.chunks.map((chunk) => ({ ...chunk, vector: passageCache.get(chunk.text) }))
        const { semantic, evidence } = scoreSemantics(queryVectors, chunks)
        const skills = skillOverlap(item.input.requiredSkills, new Set(candidate.skills))
        assert(Number.isFinite(semantic) && Number.isFinite(skills), 'Non-finite scoring component.')
        return { candidate, semantic, skills, evidence }
      })
      const semantic = normalizeScores(raws.map((raw) => raw.semantic))
      const lexical = normalizeScores(raws.map((raw) => raw.candidate.lexical))
      const ranking = raws.map((raw, i) => ({
        id: raw.candidate.id, file: raw.candidate.file, tier: raw.candidate.tier,
        cvLanguage: candidateLanguage(raw.candidate.file, item.cohort),
        score: blend(semantic[i], lexical[i], raw.skills),
        breakdown: { semantic: semantic[i], lexical: lexical[i], skills: raw.skills },
        raw: { semantic: raw.semantic, lexical: raw.candidate.lexical },
        evidence: raw.evidence.map(({ section, similarity }) => ({ section, similarity }))
      })).sort((a, b) => b.score - a.score).map((candidate, i) => ({ rank: i + 1, ...candidate }))
      assert(ranking.every((candidate) => Number.isFinite(candidate.score)), 'Non-finite final score.')
      const metrics = rankingMetrics(ranking.map((candidate) => candidate.tier), item.input.candidates.map((candidate) => candidate.tier))
      results.push({ id: item.id, family: item.family, vacancy: item.vacancy, cohort: item.cohort, language: item.language,
        candidates: ranking.length, queries: queryVectors.length, requiredSkills: item.input.requiredSkills,
        metrics, languageHits: languageHits(ranking, item.language),
        tier1Ranks: ranking.filter((candidate) => candidate.tier === 1).map((candidate) => candidate.rank), scoringMs: ms(caseStarted), ranking })
    }
    const scoringMs = ms(scoringStart)
    const grouped = (key) => Object.fromEntries([...new Set(results.map((item) => item[key]))].sort(alphabetical).map((value) => {
      const members = results.filter((item) => item[key] === value)
      return [value, { cases: members.length, metrics: meanMetrics(members), pooledLanguageRecall: pooledLanguageRecall(members) }]
    }))
    sampleRss()
    const result = {
      schemaVersion: 1, status: 'completed', createdAt: new Date().toISOString(), modelId: options.modelId,
      runtime: { node: process.version, transformers: env.version, platform: process.platform, arch: process.arch,
        cpu: cpus()[0]?.model ?? null, availableParallelism: availableParallelism(), device: 'cpu', dtype: 'q8', batchSize: options.batchSize,
        embeddingDimension: dimension, queryPrefix: QUERY_PREFIX, passagePrefix: PASSAGE_PREFIX },
      timing: { loadMs, loadFileCache: 'warmed-by-asset-hashing', queryMs, passagesMs, scoringMs, totalMs: ms(started), batches },
      cache: { distinctQueries: queryTexts.length, queryReferences, queryReuses: queryReferences - queryTexts.length,
        distinctPassages: passageTexts.length, passageReferences, passageReuses: passageReferences - passageTexts.length,
        queryOrderSha256: sha256(JSON.stringify(queryTexts)), passageOrderSha256: sha256(JSON.stringify(passageTexts)) },
      resource: { modelBytes: modelFiles.reduce((sum, file) => sum + file.bytes, 0), peakRssBytes, rssSamplingIntervalMs: 25 },
      tokenization, weights: WEIGHTS,
      provenance: { inputs: cases.map((item) => ({ file: item.file, sha256: item.sha256, input: item.input.provenance })),
        inputFilesSha256: sha256(JSON.stringify(cases.map(({ file, sha256 }) => ({ file, sha256 })))),
        scoringBundleSha256, modelFiles, modelFilesSha256: sha256(JSON.stringify(modelFiles)),
        benchmarkScriptSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
        dependencyLockSha256: sha256(await readFile(resolve(ROOT, 'package-lock.json'))) },
      summary: { cases: results.length, distinctVacancies: byVacancy.size, aggregation: 'Equal case; complete identical grids make this equal vacancy.',
        macro: meanMetrics(results), pooledLanguageRecall: pooledLanguageRecall(results),
        byFamily: grouped('family'), byPostingLanguage: grouped('language'), byCohort: grouped('cohort') },
      limitations: ['Synthetic input labels and translations require independent review.',
        'Shared embedding caches and batch size differ from the desktop ingest/search execution pattern; small numerical differences are possible.',
        'Timings include one first query forward and unique-text batching; these are not per-search application latency measurements.',
        'Sampled Node RSS excludes desktop renderer processes and is not total installed-app memory.',
        'Input SQLite lexical scores are frozen; this comparison changes the embedding model only.'],
      cases: results
    }
    await mkdir(dirname(options.outputPath), { recursive: true })
    const output = await checkOutputPath()
    const temporaryPath = `${output}.tmp-${process.pid}`
    const handle = await open(temporaryPath, 'wx')
    temporaryOutput = temporaryPath
    try { await handle.writeFile(JSON.stringify(result, null, 2) + '\n') }
    finally { await handle.close() }
    // An exclusive hard link publishes the complete file atomically. Unlike
    // rename, this also refuses to replace a competing run's completed output.
    await link(temporaryOutput, output)
    await unlink(temporaryOutput)
    temporaryOutput = undefined
    console.log(`Completed ${results.length} cases: P@3=${result.summary.macro.precisionAt3.toFixed(4)}, R@10=${result.summary.macro.recallAt10.toFixed(4)}. ${output}`)
  } finally {
    clearInterval(rssSampler)
    if (temporaryOutput) await unlink(temporaryOutput).catch(() => {})
    await extractor?.dispose()
  }
}

main().catch((error) => {
  console.error(`Domain model benchmark failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
