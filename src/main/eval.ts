/**
 * Ranking-quality evaluation, run inside Electron via `npm run eval`.
 *
 * `npm run bench` answers "is it fast enough". This answers the harder and more
 * important question: does it surface the *right* people. It ingests a labelled
 * corpus, runs one real posting, and grades the ranking against the labels.
 *
 * Ground truth comes from a separate manifest, or legacy t1_... filenames.
 * Labels never enter ranking: it consumes FTS scores, chunk embeddings and
 * text, and extracted skills.
 *
 * Uses a throwaway userData directory, so the real library is never touched.
 */
import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import {
  entriesFingerprint,
  evaluationLabels,
  evaluationPaths,
  rankingMetrics,
  sha256,
  type RelevanceTier
} from './eval-support.js'
import { MODEL_VECTOR_ID } from './embed/protocol.js'
import { diagnoseSearch, modelBenchmarkInput } from './eval-diagnostics.js'

const scratch = mkdtempSync(join(tmpdir(), 'qumaa-eval-'))
app.setPath('userData', scratch)

const ROOT = resolve(__dirname, '../..')
const paths = evaluationPaths(ROOT, process.env)

function sourceFingerprint(directory: string): string {
  const entries: Array<{ file: string; sha256: string }> = []
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        entries.push({ file: relative(ROOT, path).replace(/\\/g, '/'), sha256: sha256(readFileSync(path)) })
      }
    }
  }
  visit(directory)
  for (const file of ['package.json', 'package-lock.json', 'electron.vite.config.ts']) {
    entries.push({ file, sha256: sha256(readFileSync(join(ROOT, file))) })
  }
  return entriesFingerprint(entries)
}

function gitOutput(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length)
}

async function main(): Promise<void> {
  const { ingestFile } = await import('./ingest/pipeline.js')
  const { search } = await import('./search/rank.js')
  const { embedder, setEntryDir } = await import('./embed/client.js')

  setEntryDir(__dirname)

  const posting = readFileSync(paths.posting, 'utf8')
  if (!posting.trim()) throw new Error('The evaluation posting is empty.')
  const supportedFiles = readdirSync(paths.corpus, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(pdf|docx|md|markdown)$/i.test(entry.name) && !entry.name.startsWith('~$'))
    .map((entry) => entry.name)
  const labelsText = paths.labels ? readFileSync(paths.labels, 'utf8') : undefined
  const { files, labels, ignored } = evaluationLabels(
    supportedFiles,
    labelsText === undefined ? undefined : JSON.parse(labelsText),
    process.env.QUMAA_EVAL_IGNORE_UNLABELLED === '1'
  )
  if (ignored) console.warn(`Ignoring ${ignored} explicitly unlabelled file(s).`)
  const corpusFiles = files.map((file) => ({ file, sha256: sha256(readFileSync(join(paths.corpus, file))) }))
  const provenance = {
    modelVectorId: MODEL_VECTOR_ID,
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    sourceHead: gitOutput(['rev-parse', 'HEAD']),
    sourceTreeSha256: sourceFingerprint(join(ROOT, 'src')),
    runtimeBundleSha256: sha256(readFileSync(__filename)),
    postingSha256: sha256(posting),
    labelsSha256: sha256(JSON.stringify([...labels.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))),
    labelsFileSha256: labelsText === undefined ? null : sha256(labelsText),
    corpusSha256: entriesFingerprint(corpusFiles),
    corpusFiles
  }

  console.log(`Loading model...`)
  await embedder.start()

  console.log(`Ingesting ${files.length} resumes from ${paths.corpus}...\n`)

  const tierOfId = new Map<number, RelevanceTier>()
  const nameOfId = new Map<number, string>()
  const nearDuplicates: string[] = []
  const problems: string[] = []
  const t0 = Date.now()

  for (const [i, f] of files.entries()) {
    const outcome = await ingestFile(join(paths.corpus, f))
    const tier = labels.get(f)!

    switch (outcome.status) {
      case 'imported':
        tierOfId.set(outcome.resume.id, tier)
        nameOfId.set(outcome.resume.id, f)
        break
      case 'near-duplicate': {
        tierOfId.set(outcome.resume.id, tier)
        nameOfId.set(outcome.resume.id, f)
        const other = outcome.similarTo
        const crossTier = labels.get(other.fileName) !== tier
        nearDuplicates.push(
          `${f} ~ ${other.fileName}  ${(other.similarity * 100).toFixed(1)}%${crossTier ? '  [CROSS-TIER]' : ''}`
        )
        break
      }
      default:
        problems.push(`${f}: ${outcome.status}${'reason' in outcome ? ` - ${outcome.reason}` : ''}`)
    }

    if ((i + 1) % 10 === 0) process.stdout.write(`  ${i + 1}/${files.length}\n`)
  }

  const ingestMs = Date.now() - t0
  const imported = tierOfId.size

  if (problems.length > 0) {
    console.log(`\n${problems.length} file(s) did not import:`)
    for (const p of problems.slice(0, 12)) console.log(`  ${p}`)
    if (problems.length > 12) console.log(`  ...and ${problems.length - 12} more`)
  }

  console.log(`\nImported ${imported} of ${files.length} in ${(ingestMs / 1000).toFixed(1)}s.`)
  if (problems.length || imported !== files.length) {
    throw new Error('Evaluation aborted: every labelled resume must import; failed or duplicate files would bias the metrics.')
  }

  if (nearDuplicates.length > 0) {
    // Expected to be noisy on a generated corpus: same-function resumes written
    // by one model share vocabulary. Cross-tier flags are the ones that matter,
    // since those are demonstrably different candidates.
    console.log(`\n${nearDuplicates.length} near-duplicate flag(s):`)
    for (const d of nearDuplicates.slice(0, 15)) console.log(`  ${d}`)
    if (nearDuplicates.length > 15) console.log(`  ...and ${nearDuplicates.length - 15} more`)
  }

  console.log(`\nSearching...`)
  let diagnostics: ReturnType<typeof diagnoseSearch> | undefined
  const response = await search(posting, imported, process.env.QUMAA_EVAL_DIAGNOSTICS === '1'
    ? (inspection) => { diagnostics = diagnoseSearch(inspection) }
    : undefined)
  const ranked = response.results
  if (process.env.QUMAA_EVAL_BENCH_INPUT) {
    const input = modelBenchmarkInput(posting)
    const target = resolve(ROOT, process.env.QUMAA_EVAL_BENCH_INPUT)
    writeFileSync(target, JSON.stringify({ provenance, ...input, candidates: input.candidates.map((candidate) => ({
      ...candidate, file: nameOfId.get(candidate.id), tier: tierOfId.get(candidate.id)
    })) }, null, 2))
    console.log(`Frozen model benchmark input written to ${target}`)
  }

  if (new Set(ranked.map((result) => result.resume.id)).size !== ranked.length ||
      ranked.some((result) => !tierOfId.has(result.resume.id))) {
    throw new Error('Ranking returned duplicate or unknown candidates.')
  }
  const tiers = ranked.map((r) => tierOfId.get(r.resume.id)!)
  const counts = new Map<number, number>()
  for (const t of tierOfId.values()) counts.set(t, (counts.get(t) ?? 0) + 1)

  /* ---------- metrics ---------- */

  const tier1Total = counts.get(1) ?? 0
  const metrics = rankingMetrics(tiers, [...labels.values()])

  const scores = ranked.map((r) => r.score)
  const spread = scores.length > 1 ? scores[0] - scores[scores.length - 1] : 0
  const gapTo10 = scores.length >= 10 ? scores[0] - scores[9] : null

  const meanByTier = new Map<number, number>()
  for (const t of [1, 2, 3, 4]) {
    const s = ranked.filter((r) => (tierOfId.get(r.resume.id) ?? 4) === t).map((r) => r.score)
    if (s.length > 0) meanByTier.set(t, s.reduce((a, b) => a + b, 0) / s.length)
  }

  /* ---------- report ---------- */

  console.log(`\n${'='.repeat(64)}`)
  console.log(`RANKING QUALITY  (${imported} resumes, ${response.elapsedMs}ms)`)
  console.log('='.repeat(64))

  console.log(`\nTop 10:`)
  console.log(`  rank  tier  score  candidate`)
  ranked.slice(0, 10).forEach((r, i) => {
    const t = tierOfId.get(r.resume.id) ?? 4
    const flag = t === 1 ? ' <-' : ''
    console.log(
      `  ${String(i + 1).padStart(4)}  ${String(t).padStart(4)}  ${r.score.toFixed(3)}  ${nameOfId.get(r.resume.id) ?? r.resume.fileName}${flag}`
    )
  })

  const tier1Ranks = ranked
    .map((r, i) => ({ t: tierOfId.get(r.resume.id) ?? 4, rank: i + 1 }))
    .filter((x) => x.t === 1)
    .map((x) => x.rank)

  console.log(`\nWhere the ${tier1Total} tier-1 candidates landed: ${tier1Ranks.join(', ') || 'none ranked'}`)

  console.log(`\nMetrics:`)
  // With fewer than three tier-1 candidates, precision@3 cannot reach 100% no
  // matter how good the ranking is. Say so, rather than looking like a failure.
  const ceiling = Math.min(3, tier1Total) / 3
  const ceilingNote = ceiling < 1 ? `, max possible ${pct(ceiling)}` : ''
  console.log(`  precision@3    ${pct(metrics.precisionAt3)}   (tier-1 share of the top 3${ceilingNote})`)
  console.log(`  recall@3       ${pct(metrics.recallAt3)}   (share of all tier-1 candidates found in the top 3)`)
  console.log(`  recall@10      ${pct(metrics.recallAt10)}   (share of all tier-1 candidates found in the top 10)`)
  console.log(`  top-3 target   ${pct(metrics.top3TargetCoverage)}   (hits / min(3, tier-1 total); formerly labelled recall@3)`)
  console.log(`  RR             ${metrics.reciprocalRank.toFixed(3)}   (single-query reciprocal rank)`)
  console.log(`  NDCG@10        ${metrics.ndcg10.toFixed(3)}   (graded, tier1=3 tier2=2 tier3=1 tier4=0)`)

  console.log(`\nScore separation:`)
  for (const t of [1, 2, 3, 4]) {
    const m = meanByTier.get(t)
    if (m !== undefined) console.log(`  tier ${t} mean   ${m.toFixed(3)}  (n=${counts.get(t) ?? 0})`)
  }
  console.log(`  full spread    ${spread.toFixed(3)}  (rank 1 minus last)`)
  console.log(`  rank 1 to 10   ${gapTo10 === null ? 'n/a (fewer than 10 results)' : gapTo10.toFixed(3)}`)
  console.log(`  stdev          ${stdev(scores).toFixed(3)}`)

  // Tier means that sit on top of each other mean the ranking is not
  // discriminating, even if the ordering happens to look right.
  const m1 = meanByTier.get(1)
  const m3 = meanByTier.get(3)
  if (m1 !== undefined && m3 !== undefined && m1 - m3 < 0.1) {
    console.log(`\n  ! tier 1 and tier 3 means differ by only ${(m1 - m3).toFixed(3)}.`)
    console.log(`    Scores are compressed; the ordering may not be meaningful.`)
  }

  console.log(`\nDetected requirements: ${response.requiredSkills.join(', ') || '(none)'}`)

  mkdirSync(paths.results, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const out = join(paths.results, `${stamp}.json`)
  writeFileSync(
    out,
    JSON.stringify(
      {
        schemaVersion: 2,
        status: 'completed',
        ranAt: new Date().toISOString(),
        provenance,
        ...(diagnostics ? { diagnostics: {
          ...diagnostics,
          candidates: diagnostics.candidates.map(({ resumeId, ...candidate }) => ({
            file: nameOfId.get(resumeId), ...candidate
          }))
        } } : {}),
        ignoredUnlabelled: ignored,
        corpusSize: files.length,
        imported,
        ingestMs,
        searchMs: response.elapsedMs,
        metrics,
        tier1Ranks,
        meanByTier: Object.fromEntries(meanByTier),
        spread,
        requiredSkills: response.requiredSkills,
        nearDuplicates,
        problems,
        ranking: ranked.map((r, i) => ({
          rank: i + 1,
          tier: tierOfId.get(r.resume.id) ?? 4,
          file: nameOfId.get(r.resume.id) ?? r.resume.fileName,
          score: r.score,
          breakdown: r.breakdown,
          // Which sections the winning passages came from. A candidate whose
          // every match sits in a summary is asserting, not evidencing.
          evidence: r.evidence.map((e) => ({ section: e.section, similarity: e.similarity }))
        }))
      },
      null,
      2
    ),
    'utf8'
  )
  console.log(`\nFull ranking written to ${out}`)

  embedder.stop()
  rmSync(scratch, { recursive: true, force: true })
  app.exit(0)
}

app.whenReady().then(main).catch((err: unknown) => {
  console.error('Evaluation failed:', err)
  rmSync(scratch, { recursive: true, force: true })
  app.exit(1)
})
