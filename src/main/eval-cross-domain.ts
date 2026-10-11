/** Isolated multi-vacancy evaluation through the actual Electron ingest/search path. */
import { app, BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { careerLanguage, familySchema, languageRecall, macroMetrics, manifestSchema, type Cohort, type Language, type MetricCase } from './eval-cross-domain-support.js'
import { entriesFingerprint, rankingMetrics, sha256, type RelevanceTier } from './eval-support.js'
import { MODEL_VECTOR_ID } from './embed/protocol.js'
import { WEIGHTS } from './search/scoring.js'
import { extractSkills } from './ingest/skills.js'
import { extractJobRequirements } from '../shared/job-requirements.js'
import { modelBenchmarkInput } from './eval-diagnostics.js'

const scratch = mkdtempSync(join(tmpdir(), 'qumaa-cross-domain-'))
app.setPath('userData', scratch)
const ROOT = resolve(__dirname, '../..')
const FIXTURES = resolve(ROOT, process.env.QUMAA_CROSS_DOMAIN_FIXTURES || 'eval/cross-domain')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const OUTPUT = resolve(ROOT, process.env.QUMAA_CROSS_DOMAIN_RESULTS || `eval/results/cross-domain/${stamp}`)
const BENCH_INPUT = process.env.QUMAA_CROSS_DOMAIN_BENCH_INPUT ? resolve(ROOT, process.env.QUMAA_CROSS_DOMAIN_BENCH_INPUT) : null
const split = process.env.QUMAA_CROSS_DOMAIN_SPLIT || 'development'
const cohortNames = (process.env.QUMAA_CROSS_DOMAIN_COHORTS || 'mixed-a,mixed-b').split(',')

async function inventory(directory: string): Promise<Array<{ file: string; sha256: string }>> {
  const files: Array<{ file: string; sha256: string }> = []
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Evaluation runtime/model inventory must not contain symlinks.')
    if (entry.isDirectory()) files.push(...await inventory(path))
    else if (entry.isFile()) {
      const digest = createHash('sha256')
      for await (const chunk of createReadStream(path)) digest.update(chunk)
      files.push({ file: relative(ROOT, path), sha256: digest.digest('hex') })
    }
  }
  return files
}

async function main(): Promise<void> {
  if (!['development', 'reserved', 'all'].includes(split)) throw new Error('Invalid evaluation split.')
  if (!cohortNames.length || new Set(cohortNames).size !== cohortNames.length || cohortNames.some((cohort) => !['mixed-a', 'mixed-b', 'english', 'arabic'].includes(cohort))) throw new Error('Invalid or repeated cohort.')
  const manifestBytes = readFileSync(join(FIXTURES, 'manifest.json'))
  const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
  const families = manifest.families.map((entry) => {
    const bytes = readFileSync(join(FIXTURES, 'families', `${entry.family}.json`))
    const data = familySchema.parse(JSON.parse(bytes.toString('utf8')))
    if (data.family !== entry.family) throw new Error('Family identity does not match manifest.')
    return { ...entry, data, sha256: sha256(bytes) }
  })
  // Development excludes reserved careers as well as their postings. Reserved
  // evaluation includes the development distractors, with one CV per career.
  const corpusFamilies = families.filter((family) => split !== 'development' || family.split === 'development')
  const evaluated = families.filter((family) => split === 'all' || family.split === split)
  if (!evaluated.length) throw new Error('No evaluation families selected.')
  const keeper = new BrowserWindow({ show: false })
  const { embedder, setEntryDir } = await import('./embed/client.js')
  const { ingestText } = await import('./ingest/pipeline.js')
  const { search } = await import('./search/rank.js')
  const { deleteAllData, closeDbForMaintenance } = await import('./db/index.js')
  const { parseRequirements } = await import('./search/scoring.js')
  setEntryDir(__dirname)
  const sourceFiles: Array<{ file: string; sha256: string }> = []
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) sourceFiles.push({ file: relative(ROOT, path), sha256: sha256(readFileSync(path)) })
    }
  }
  visit(join(ROOT, 'src'))
  const provenance = { modelVectorId: MODEL_VECTOR_ID, node: process.versions.node, electron: process.versions.electron,
    manifestSha256: sha256(manifestBytes), fixtureHashes: families.map(({ family, sha256 }) => ({ family, sha256 })),
    sourceTreeSha256: entriesFingerprint(sourceFiles), runtimeBundleSha256: sha256(readFileSync(__filename)),
    runtimeFiles: await inventory(__dirname), modelFiles: await inventory(join(ROOT, 'resources/models/multilingual-e5-small')),
    packageSha256: sha256(readFileSync(join(ROOT, 'package.json'))), lockSha256: sha256(readFileSync(join(ROOT, 'package-lock.json'))), weights: WEIGHTS }
  mkdirSync(OUTPUT, { recursive: true })
  if (BENCH_INPUT) mkdirSync(BENCH_INPUT, { recursive: true })
  const cases: Array<MetricCase & Record<string, unknown>> = []
  const ablations: Record<string, MetricCase[]> = { withoutDictionary: [], semanticOnly: [], coverageWeightedDictionary: [] }
  const started = Date.now()
  try {
    await embedder.start()
    for (const cohort of cohortNames as Cohort[]) {
      deleteAllData()
      const identities = new Map<number, { family: string; career: string; language: Language }>()
      const importStarted = Date.now()
      for (const family of corpusFamilies) {
        for (const [index, candidate] of family.data.candidates.entries()) {
          const language = careerLanguage(index, cohort)
          const identity = `${family.family}/${candidate.id}`
          const outcome = await ingestText({ text: candidate[language], fileName: `${identity.replace('/', '-')}.md`, filePath: '', fileType: 'md' })
          if (outcome.status !== 'imported' && outcome.status !== 'near-duplicate') throw new Error(`Incomplete corpus: ${identity}: ${outcome.status}`)
          identities.set(outcome.resume.id, { family: family.family, career: candidate.id, language })
        }
      }
      console.log(`${cohort}: ingested ${identities.size} distinct careers in ${Date.now() - importStarted}ms.`)
      for (const family of evaluated) for (const vacancy of family.data.vacancies) for (const language of ['en', 'ar'] as const) {
        const id = `${family.family}/${vacancy.id}/${cohort}/${language}`
        const posting = vacancy.posting[language]
        const requirementDrafts = extractJobRequirements({ position: '', jobDescription: posting, requirements: '', educationAndCertifications: '' }).requirements
        const dictionaryClauseFraction = requirementDrafts.length ? requirementDrafts.filter((requirement) => extractSkills(requirement.text).length > 0).length / requirementDrafts.length : 0
        const response = await search(posting, identities.size)
        if (response.results.length !== identities.size || new Set(response.results.map((r) => r.resume.id)).size !== identities.size) throw new Error('Incomplete or repeated search results.')
        const ranking = response.results.map((result, index) => {
          const identity = identities.get(result.resume.id)
          if (!identity) throw new Error('Unknown candidate returned by search.')
          const tier: RelevanceTier = identity.family === family.family ? vacancy.labels[identity.career] : 4
          return { rank: index + 1, ...identity, tier, score: result.score, breakdown: result.breakdown,
            evidence: result.evidence.map(({ section, similarity }) => ({ section, similarity })) }
        })
        const tiers = ranking.map((candidate) => candidate.tier)
        const metrics = rankingMetrics(tiers, tiers)
        const base = { id, family: family.family, vacancy: vacancy.id, language, cohort }
        if (BENCH_INPUT) {
          const input = modelBenchmarkInput(posting)
          writeFileSync(join(BENCH_INPUT, `${id.replaceAll('/', '--')}.json`), JSON.stringify({
            provenance: { ...provenance, case: base }, ...input,
            candidates: input.candidates.map((candidate) => {
              const identity = identities.get(candidate.id)
              if (!identity) throw new Error('Unknown benchmark candidate.')
              return { ...candidate, file: `${identity.family}/${identity.career}`, tier: identity.family === family.family ? vacancy.labels[identity.career] : 4 }
            })
          }, null, 2) + '\n', { flag: 'wx' })
        }
        const result = { ...base, seniority: vacancy.seniority, split: family.split, metrics,
          requiredSkills: response.requiredSkills, parsedRequirementCount: parseRequirements(posting).length,
          requirementDraftCount: requirementDrafts.length, dictionaryClauseFraction,
          relevant: tiers.filter((tier) => tier === 1).length, candidates: ranking.length, searchMs: response.elapsedMs,
          cvLanguageRecall: { en: languageRecall(ranking, 'en'), ar: languageRecall(ranking, 'ar') },
          postingSha256: sha256(posting), ranking }
        cases.push(result)
        for (const variant of Object.keys(ablations)) {
          const score = (candidate: typeof ranking[number]): number => {
            if (variant === 'semanticOnly') return candidate.breakdown.semantic
            const withoutDictionary = (WEIGHTS.semantic * candidate.breakdown.semantic + WEIGHTS.lexical * candidate.breakdown.lexical) / (WEIGHTS.semantic + WEIGHTS.lexical)
            if (variant === 'withoutDictionary') return withoutDictionary
            const skillWeight = WEIGHTS.skills * dictionaryClauseFraction
            return (1 - skillWeight) * withoutDictionary + skillWeight * candidate.breakdown.skills
          }
          // Score ties follow the original ingest order, as production does.
          const order = new Map([...identities.keys()].map((resumeId, index) => {
            const person = identities.get(resumeId)!
            return [`${person.family}/${person.career}`, index]
          }))
          const ranked = [...ranking].sort((a, b) => score(b) - score(a) || order.get(`${a.family}/${a.career}`)! - order.get(`${b.family}/${b.career}`)!)
          ablations[variant].push({ ...base, metrics: rankingMetrics(ranked.map((candidate) => candidate.tier), tiers) })
        }
        writeFileSync(join(OUTPUT, `${id.replaceAll('/', '--')}.json`), JSON.stringify({ schemaVersion: 1, status: 'completed', provenance, ...result }, null, 2) + '\n', { flag: 'wx' })
        console.log(`${id}: P@3=${metrics.precisionAt3.toFixed(3)} R@10=${metrics.recallAt10.toFixed(3)} skills=${response.requiredSkills.length}`)
      }
    }
    const expected = evaluated.reduce((sum, family) => sum + family.data.vacancies.length, 0) * 2 * cohortNames.length
    if (cases.length !== expected) throw new Error('Incomplete suite; refusing successful summary.')
    const groups = (field: 'family' | 'language') => Object.fromEntries([...new Set(cases.map((item) => item[field]))].map((name) => {
      const selected = cases.filter((item) => item[field] === name)
      return [name, { cases: selected.length, metrics: macroMetrics(selected), zeroDetectedSkillCases: selected.filter((item) => (item.requiredSkills as string[]).length === 0).length }]
    }))
    const summary = { schemaVersion: 1, status: 'completed', createdAt: new Date().toISOString(), provenance, split,
      reviewStatus: 'synthetic-unreviewed', cohorts: cohortNames, cases: cases.length,
      distinctVacancies: evaluated.reduce((sum, family) => sum + family.data.vacancies.length, 0),
      distinctCareers: corpusFamilies.reduce((sum, family) => sum + family.data.candidates.length, 0),
      elapsedMs: Date.now() - started, macro: macroMetrics(cases), byFamily: groups('family'), byPostingLanguage: groups('language'),
      ablations: Object.fromEntries(Object.entries(ablations).map(([name, records]) => [name, { macro: macroMetrics(records),
        byFamily: Object.fromEntries(evaluated.map((family) => [family.family, macroMetrics(records.filter((item) => item.family === family.family))])) }])),
      limitations: ['Synthetic labels and translations have not been independently reviewed.', 'Other-family careers provisionally receive tier 4; cross-family relevance needs review.', 'Translations and seniority variants are repeated career measurements.', 'Markdown text path only; this suite does not validate PDF/DOCX extraction.', 'Ablations are offline diagnostics, not production changes.'],
      ablationDefinitions: { withoutDictionary: 'Redistribute the skill weight proportionally across production semantic/lexical weights.', semanticOnly: 'Order by the production normalized semantic component.', coverageWeightedDictionary: 'Multiply the production skill weight by the fraction of extracted requirement drafts with at least one dictionary term, and redistribute the remainder proportionally. A vocabulary-coverage proxy, not verified requirement understanding.' },
      caseMetrics: cases.map(({ ranking: _ranking, ...item }) => item) }
    writeFileSync(join(OUTPUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' })
    console.log(`Completed ${cases.length} cases. Macro P@3=${summary.macro.precisionAt3.toFixed(3)}, R@10=${summary.macro.recallAt10.toFixed(3)}. ${join(OUTPUT, 'summary.json')}`)
  } finally {
    embedder.stop()
    closeDbForMaintenance()
    keeper.destroy()
  }
}
app.whenReady().then(main).then(() => {
  rmSync(scratch, { recursive: true, force: true }); app.exit(0)
}).catch((error: unknown) => {
  console.error('Cross-domain evaluation failed:', error)
  rmSync(scratch, { recursive: true, force: true }); app.exit(1)
})
