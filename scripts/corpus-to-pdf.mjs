/**
 * Converts a slice of the evaluation corpus from DOCX to PDF, so the ingest
 * test exercises `unpdf` and not only `mammoth`. PDF is what recruiters
 * actually receive most often, and it is the harder extractor of the two.
 *
 * Conversion goes through Microsoft Word rather than a text-layer renderer,
 * because a Word export is exactly what a real applicant sends. Verified to
 * produce a clean text layer that the app's own extractor reads.
 *
 * The DOCX is deleted after a successful conversion. Keeping both would put the
 * same person in the corpus twice, where content hashing would reject the
 * second copy as a duplicate and quietly shrink the corpus.
 *
 *   node scripts/corpus-to-pdf.mjs [fraction]     default 0.15
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const corpus = join(root, 'eval', 'corpus')
const fraction = Number(process.argv[2] ?? 0.15)

if (!existsSync(corpus)) {
  console.error(`No corpus directory at ${corpus}`)
  process.exit(1)
}

const docx = readdirSync(corpus)
  .filter((f) => f.toLowerCase().endsWith('.docx') && !f.startsWith('~$'))
  .sort()

if (docx.length === 0) {
  console.error('No .docx files found. Put the generated resumes in eval/corpus first.')
  process.exit(1)
}

// Stratify by tier. Converting the first N alphabetically would take them all
// from tier 1, leaving the PDF path tested only on the strongest candidates.
const byTier = new Map()
for (const f of docx) {
  const tier = /^t(\d)_/.exec(f)?.[1] ?? '?'
  if (!byTier.has(tier)) byTier.set(tier, [])
  byTier.get(tier).push(f)
}

const chosen = []
for (const [tier, files] of [...byTier.entries()].sort()) {
  const take = Math.max(1, Math.round(files.length * fraction))
  // Evenly spaced through the tier rather than the first few, so the sample is
  // not biased toward whatever ordering the generator happened to emit.
  const step = files.length / take
  for (let i = 0; i < take; i++) chosen.push(files[Math.floor(i * step)])
  console.log(`  tier ${tier}: ${take} of ${files.length}`)
}

console.log(`\nConverting ${chosen.length} of ${docx.length} resumes to PDF via Word...`)

// One AppleScript for the whole batch: launching Word per file is far slower,
// and leaves a window flashing open for every resume.
const entries = chosen
  .map((f) => {
    const src = join(corpus, f)
    const out = src.replace(/\.docx$/i, '.pdf')
    return `  convertOne("${src}", "${out}")`
  })
  .join('\n')

const script = `
on convertOne(srcPath, outPath)
  tell application "Microsoft Word"
    open POSIX file srcPath
    set d to active document
    save as d file name (POSIX file outPath) file format format PDF
    close d saving no
  end tell
end convertOne

tell application "Microsoft Word"
  set wasRunning to running
end tell

${entries}

tell application "Microsoft Word"
  if not wasRunning then quit saving no
end tell
`

try {
  execFileSync('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
} catch (err) {
  console.error('\nWord conversion failed:')
  console.error(err.stderr?.toString().trim() || err.message)
  console.error('\nNothing was deleted; no resume was lost.')
  console.error('If the error mentions permission, grant Terminal automation access')
  console.error('to Word once in System Settings > Privacy & Security > Automation.')
  process.exit(1)
}

// Only remove a source once its PDF exists and is non-empty. A silent Word
// failure must not cost us the resume.
let converted = 0
for (const f of chosen) {
  const src = join(corpus, f)
  const pdf = src.replace(/\.docx$/i, '.pdf')
  if (existsSync(pdf) && statSync(pdf).size > 0) {
    unlinkSync(src)
    converted++
  } else {
    console.warn(`  ! ${f} did not convert; left as .docx`)
  }
}

const remaining = readdirSync(corpus).filter((f) => f.toLowerCase().endsWith('.docx')).length
console.log(`\n${converted} PDF, ${remaining} DOCX. Both extractors now covered.`)
