/**
 * Ranking-quality evaluation, run inside Electron via `npm run eval`.
 *
 * `npm run bench` answers "is it fast enough". This answers the harder and more
 * important question: does it surface the *right* people. It ingests a labelled
 * corpus, runs one real posting, and grades the ranking against the labels.
 *
 * Ground truth lives in the filename (`t1_03_hannah_reid.docx`). That is safe
 * because nothing in ranking reads a filename: FTS5 indexes only `raw_text`,
 * and the scorer sees chunk embeddings, `raw_text`, and extracted skills.
 *
 * Uses a throwaway userData directory, so the real library is never touched.
 */
import { app } from 'electron'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const scratch = mkdtempSync(join(tmpdir(), 'qumaa-eval-'))
app.setPath('userData', scratch)

const ROOT = resolve(__dirname, '../..')
const CORPUS = join(ROOT, 'eval', 'corpus')
const POSTING = join(ROOT, 'eval', 'posting.txt')
const RESULTS = join(ROOT, 'eval', 'results')

/** Graded relevance per tier, used for NDCG. Tier 4 is a true non-match. */
const GAIN: Record<number, number> = { 1: 3, 2: 2, 3: 1, 4: 0 }

function tierOf(fileName: string): number | null {
  const m = /^t(\d)_/i.exec(fileName)
  return m ? Number(m[1]) : null
}

function dcg(gains: number[]): number {
  return gains.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0)
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

  let posting: string
  try {
    posting = readFileSync(POSTING, 'utf8')
  } catch {
    console.error(`No posting at ${POSTING}`)
    console.error('Save the job description you generated the corpus against there.')
    app.exit(1)
    return
  }

  let files: string[]
  try {
    files = readdirSync(CORPUS)
      .filter((f) => /\.(pdf|docx|txt|md)$/i.test(f) && !f.startsWith('~$'))
      .sort()
  } catch {
    console.error(`No corpus at ${CORPUS}`)
    app.exit(1)
    return
  }

  if (files.length === 0) {
    console.error(`No resumes in ${CORPUS}`)
    app.exit(1)
    return
  }

  const unlabelled = files.filter((f) => tierOf(f) === null)
  if (unlabelled.length > 0) {
    // Without a tier there is nothing to grade against, and a silently
    // ungraded corpus would produce confident but meaningless numbers.
    console.error(`${unlabelled.length} file(s) have no t<n>_ tier prefix, e.g. ${unlabelled[0]}`)
    console.error('Rename them or the results cannot be graded. See eval/README.md.')
    app.exit(1)
    return
  }

  console.log(`Loading model...`)
  await embedder.start()

  console.log(`Ingesting ${files.length} resumes from eval/corpus...\n`)

  const tierOfId = new Map<number, number>()
  const nameOfId = new Map<number, string>()
  const nearDuplicates: string[] = []
  const problems: string[] = []
  const t0 = Date.now()

  for (const [i, f] of files.entries()) {
    const outcome = await ingestFile(join(CORPUS, f))
    const tier = tierOf(f)!

    switch (outcome.status) {
      case 'imported':
        tierOfId.set(outcome.resume.id, tier)
        nameOfId.set(outcome.resume.id, f)
        break
      case 'near-duplicate': {
        tierOfId.set(outcome.resume.id, tier)
        nameOfId.set(outcome.resume.id, f)
        const other = outcome.similarTo
        const crossTier = tierOf(other.fileName) !== tier
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

  if (nearDuplicates.length > 0) {
    // Expected to be noisy on a generated corpus: same-function resumes written
    // by one model share vocabulary. Cross-tier flags are the ones that matter,
    // since those are demonstrably different candidates.
    console.log(`\n${nearDuplicates.length} near-duplicate flag(s):`)
    for (const d of nearDuplicates.slice(0, 15)) console.log(`  ${d}`)
    if (nearDuplicates.length > 15) console.log(`  ...and ${nearDuplicates.length - 15} more`)
  }

  console.log(`\nSearching...`)
  const response = await search(posting, imported)
  const ranked = response.results

  const tiers = ranked.map((r) => tierOfId.get(r.resume.id) ?? 4)
  const counts = new Map<number, number>()
  for (const t of tierOfId.values()) counts.set(t, (counts.get(t) ?? 0) + 1)

  /* ---------- metrics ---------- */

  const top3 = tiers.slice(0, 3)
  const precisionAt3 = top3.filter((t) => t === 1).length / 3
  const tier1Total = counts.get(1) ?? 0
  const recallAt3 = tier1Total > 0 ? top3.filter((t) => t === 1).length / Math.min(3, tier1Total) : 0

  const firstTier1 = tiers.findIndex((t) => t === 1)
  const mrr = firstTier1 === -1 ? 0 : 1 / (firstTier1 + 1)

  const gains = tiers.map((t) => GAIN[t] ?? 0)
  const ideal = [...gains].sort((a, b) => b - a)
  const ndcg10 = dcg(ideal.slice(0, 10)) === 0 ? 0 : dcg(gains.slice(0, 10)) / dcg(ideal.slice(0, 10))

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
  console.log(`  precision@3    ${pct(precisionAt3)}   (tier-1 share of the top 3${ceilingNote})`)
  console.log(`  recall@3       ${pct(recallAt3)}   (tier-1 found in the top 3)`)
  console.log(`  MRR            ${mrr.toFixed(3)}   (1 / rank of the first tier-1)`)
  console.log(`  NDCG@10        ${ndcg10.toFixed(3)}   (graded, tier1=3 tier2=2 tier3=1 tier4=0)`)

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

  mkdirSync(RESULTS, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const out = join(RESULTS, `${stamp}.json`)
  writeFileSync(
    out,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        corpusSize: files.length,
        imported,
        ingestMs,
        searchMs: response.elapsedMs,
        metrics: { precisionAt3, recallAt3, mrr, ndcg10 },
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
          breakdown: r.breakdown
        }))
      },
      null,
      2
    ),
    'utf8'
  )
  console.log(`\nFull ranking written to eval/results/${stamp}.json`)

  embedder.stop()
  rmSync(scratch, { recursive: true, force: true })
  app.exit(0)
}

app.whenReady().then(main).catch((err: unknown) => {
  console.error('Evaluation failed:', err)
  rmSync(scratch, { recursive: true, force: true })
  app.exit(1)
})
