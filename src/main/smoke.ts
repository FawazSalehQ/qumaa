/**
 * Headless integration check, run inside Electron via `npm run smoke`.
 *
 * Covers exactly the seams the vitest suite cannot: better-sqlite3 under
 * Electron's ABI, the embedding utilityProcess, FTS5/bm25, real PDF and DOCX
 * parsing, and the full ingest → search round trip. Uses a throwaway userData
 * directory so it never touches the real library.
 */
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const scratch = mkdtempSync(join(tmpdir(), 'cv-filter-smoke-'))
app.setPath('userData', scratch)

let failures = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok    ${label}${detail ? `: ${detail}` : ''}`)
  } else {
    failures++
    console.error(`  FAIL  ${label}${detail ? `: ${detail}` : ''}`)
  }
}

async function run(): Promise<void> {
  // Production always has its main window while the exporter's temporary
  // offscreen window is created and destroyed. Keep the same lifecycle here;
  // otherwise closing the exporter is the transition to zero windows and
  // Electron tears down the embedding utility process on some platforms.
  const keeperWindow = new BrowserWindow({ show: false })

  // Start from the previous resume schema so opening this database exercises
  // the real additive migration, not only creation of a brand-new library.
  const { default: Database } = await import('better-sqlite3')
  const legacyDb = new Database(join(scratch, 'cv_filter.db'))
  legacyDb.exec(`CREATE TABLE resumes (
    id INTEGER PRIMARY KEY,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    file_type TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    raw_text TEXT NOT NULL,
    name TEXT,
    email TEXT,
    phone TEXT,
    location TEXT,
    years_experience REAL,
    education_level TEXT,
    skills_json TEXT NOT NULL DEFAULT '[]',
    likely_scanned INTEGER NOT NULL DEFAULT 0
  )`)
  legacyDb.close()

  const { getDb, stats, setSetting, getSetting, deleteAllData } = await import('./db/index.js')
  const { embedder, setEntryDir } = await import('./embed/client.js')
  const {
    isIndexCommitted,
    markEmptyIndexCurrent,
    needsReindex,
    reindexAll,
    storedModel
  } = await import('./embed/reindex.js')
  const { backfillDocumentVectors } = await import('./ingest/duplicates.js')
  // Must be the entry file's own __dirname; see setEntryDir's comment.
  setEntryDir(__dirname)
  const { ingestFile, ingestText, collectFiles } = await import('./ingest/pipeline.js')
  const { backfillResumeSkills, SKILL_GAZETTEER_VERSION } = await import(
    './ingest/skills-backfill.js'
  )
  const { search } = await import('./search/rank.js')
  const { shortlistHtml, writeShortlistPdf } = await import('./export/shortlist.js')

  console.log('\n1. Database (better-sqlite3 under Electron)')
  getDb()
  check('opens and creates schema', stats().resumeCount === 0)
  const migratedColumns = new Set(
    (getDb().prepare('PRAGMA table_info(resumes)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )
  check('migrates old libraries for skill versions', migratedColumns.has('skills_version'))
  check('migrates old libraries for document vectors', migratedColumns.has('doc_vector'))
  check('records vector provenance for an empty index', markEmptyIndexCurrent())

  console.log('\n2. Embedding utility process')
  await embedder.start()
  const status = embedder.getStatus()
  check('model reports ready', status.state === 'ready', JSON.stringify(status))
  const [v] = await embedder.embedPassages(['hello world'])
  check('returns a 384-dim unit vector', v.length === 384)
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  check('vector is L2-normalised', Math.abs(norm - 1) < 1e-3, `norm=${norm.toFixed(5)}`)

  console.log('\n3. Real file ingest')
  // This file runs from out/main/, so the project root is two levels up.
  const fixtures = resolve(__dirname, '..', '..', 'test/fixtures/files')
  const files = await collectFiles(fixtures)
  check('finds both fixtures', files.length === 2, files.map((f) => basename(f)).join(', '))

  for (const file of files) {
    const outcome = await ingestFile(file)
    // near-duplicate also means imported, just flagged as resembling another.
    const ok = outcome.status === 'imported' || outcome.status === 'near-duplicate'
    check(
      `imports ${basename(file)}`,
      ok,
      outcome.status === 'imported' || outcome.status === 'near-duplicate'
        ? `name="${outcome.resume.name}" email=${outcome.resume.email} yrs=${outcome.resume.yearsExperience} skills=${outcome.resume.skills.length}`
        : JSON.stringify(outcome)
    )
  }

  console.log('\n4. Deduplication')
  const again = await ingestFile(files[0])
  check('re-importing the same file is a duplicate', again.status === 'duplicate')

  console.log('\n5. Pasted text ingest')
  const pasted = await ingestText({
    text: `Robert Iwu\nrobert@example.com\n\nWORK EXPERIENCE\nUnilever - Senior Management Accountant\nApr 2015 - Dec 2023\nPrepared corporate tax computations and VAT returns.\nMaintained the general ledger and reconciled accounts payable.\n\nEDUCATION\nCPA, 2017\n\nSKILLS\nTaxation, VAT, general ledger, financial reporting, Excel`,
    fileName: 'Robert Iwu (pasted)',
    filePath: '',
    fileType: 'pasted'
  })
  check(
    'accepts pasted resume',
    pasted.status === 'imported' || pasted.status === 'near-duplicate'
  )

  // Simulate opening a library whose vectors came from another model. Direct
  // ingestion must never overwrite this library-wide marker; production holds
  // ingestion behind the readiness barrier until the migration below finishes.
  setSetting('embeddingModel', 'legacy-model')

  console.log('\n5b. Near-duplicate detection')
  // Same person, one edited date. Byte hashing cannot catch this; the document
  // vector should.
  const edited = await ingestText({
    text: `Robert Iwu\nrobert@example.com\n\nWORK EXPERIENCE\nUnilever - Senior Management Accountant\nApr 2015 - Jan 2024\nPrepared corporate tax computations and VAT returns.\nMaintained the general ledger and reconciled accounts payable.\n\nEDUCATION\nCPA, 2017\n\nSKILLS\nTaxation, VAT, general ledger, financial reporting, Excel`,
    fileName: 'Robert Iwu (edited)',
    filePath: '',
    fileType: 'pasted'
  })
  check(
    'flags a lightly edited resume as a near-duplicate',
    edited.status === 'near-duplicate',
    edited.status === 'near-duplicate'
      ? `${(edited.similarTo.similarity * 100).toFixed(1)}% like "${edited.similarTo.name}"`
      : `got status=${edited.status}`
  )
  check('ingestion cannot falsely mark a stale index current', storedModel() === 'legacy-model')

  console.log('\n5c. Skill-gazetteer backfill')
  const stale = getDb()
    .prepare("SELECT id FROM resumes WHERE name = 'Maria Chen'")
    .get() as { id: number }
  getDb()
    .prepare("UPDATE resumes SET skills_json = '[]', skills_version = 'legacy' WHERE id = ?")
    .run(stale.id)
  const skillBackfill = backfillResumeSkills()
  const refreshed = getDb()
    .prepare('SELECT skills_json AS skillsJson, skills_version AS skillsVersion FROM resumes WHERE id = ?')
    .get(stale.id) as { skillsJson: string; skillsVersion: string }
  check('refreshes exactly the stale resume', skillBackfill.updated === 1)
  check('re-extracts skills from retained text', refreshed.skillsJson !== '[]', refreshed.skillsJson)
  check('records the current gazetteer version', refreshed.skillsVersion === SKILL_GAZETTEER_VERSION)

  console.log('\n5d. Full index migration')
  check('detects stale vector provenance', needsReindex())
  const rewritten = await reindexAll()
  check('rewrites every stored passage', rewritten === stats().chunkCount, `${rewritten} passages`)
  check('commits the model marker only after rewriting', isIndexCommitted())
  const missingDocumentVectors = (
    getDb().prepare('SELECT COUNT(*) c FROM resumes WHERE doc_vector IS NULL').get() as { c: number }
  ).c
  check('invalidates vectors derived from old passages', missingDocumentVectors === stats().resumeCount)
  const documentVectors = backfillDocumentVectors()
  check('rebuilds every derived document vector', documentVectors === stats().resumeCount)

  console.log('\n6. Search round trip (semantic + FTS5 bm25 + skills)')
  const res = await search(`Senior Backend Engineer

Requirements:
- Five or more years building production backend services
- Strong experience with Go or Python
- Deep familiarity with Kubernetes and containerised deployments
- Experience operating PostgreSQL at scale
- Experience with AWS and infrastructure as code`)

  check('scores every candidate', res.totalCandidates === 4, `${res.totalCandidates} candidates`)
  check('detects skills in the posting', res.requiredSkills.length > 0, res.requiredSkills.join(', '))

  const top = res.results[0]
  check('ranks the backend engineer first', top.resume.name === 'Maria Chen', `got "${top.resume.name}" @ ${top.score.toFixed(3)}`)
  check('returns supporting evidence', top.evidence.length > 0, `${top.evidence.length} passages`)
  check('reports matched skills', top.matchedSkills.length > 0, top.matchedSkills.join(', '))
  // bm25 is the seam most likely to silently return nothing; a non-uniform
  // lexical column proves FTS5 actually matched and ranked.
  const lexicals = res.results.map((r) => r.breakdown.lexical)
  check('FTS5 bm25 produced varying scores', new Set(lexicals).size > 1, lexicals.map((n) => n.toFixed(2)).join(' / '))

  console.log('\n   ranking:')
  for (const [i, r] of res.results.entries()) {
    console.log(
      `     ${i + 1}. ${(r.resume.name ?? r.resume.fileName).padEnd(22)} ${r.score.toFixed(3)}  ` +
        `sem=${r.breakdown.semantic.toFixed(2)} lex=${r.breakdown.lexical.toFixed(2)} skl=${r.breakdown.skills.toFixed(2)}`
    )
  }

  console.log('\n6b. Shortlist PDF export')
  const pdfPath = join(scratch, 'shortlist.pdf')
  await writeShortlistPdf(
    shortlistHtml({
      jobTitle: 'Senior Backend Engineer',
      requiredSkills: res.requiredSkills,
      results: res.results.slice(0, 3),
      generatedAt: new Date('2026-08-28T00:00:00Z')
    }),
    pdfPath
  )
  const pdf = readFileSync(pdfPath)
  check('writes a real PDF document', pdf.subarray(0, 5).toString() === '%PDF-')
  check('PDF contains rendered content', statSync(pdfPath).size > 1_000, `${statSync(pdfPath).size} bytes`)

  console.log('\n7. Nurse posting picks the nurse')
  const nurseRes = await search(`Registered Nurse - Intensive Care Unit

Requirements:
- Valid nursing registration with ICU experience
- Confident managing ventilated and critically ill patients
- Skilled in patient assessment and medication administration
- Current BLS and ACLS certification`)
  check(
    'ranks the nurse first',
    nurseRes.results[0].resume.name === 'Aisha Rahman',
    `got "${nurseRes.results[0].resume.name}"`
  )

  console.log(`\n8. Final state: ${stats().resumeCount} resumes, ${stats().chunkCount} chunks`)

  // 9. The wipe is irreversible and sits behind a button in Settings, so it is
  // checked here rather than trusted: everything gone, FTS not left orphaned,
  // and a usable database afterwards.
  console.log('\n9. Delete all data')
  setSetting('theme', 'dark')
  deleteAllData()
  check('removes every resume', stats().resumeCount === 0, `${stats().resumeCount} left`)
  check('removes every chunk', stats().chunkCount === 0, `${stats().chunkCount} left`)
  check('removes stored settings', getSetting('theme') === null, String(getSetting('theme')))

  const orphaned = getDb()
    .prepare("SELECT COUNT(*) c FROM resumes_fts WHERE resumes_fts MATCH 'engineer'")
    .get() as { c: number }
  check('leaves no orphaned FTS rows', orphaned.c === 0, `${orphaned.c} stale rows`)

  check('restores provenance before post-wipe ingestion', markEmptyIndexCurrent())
  check('post-wipe index marker is current', isIndexCommitted())

  const after = await ingestText({
    text: 'Dana Reyes\ndana@example.com\n\nWORK EXPERIENCE\nAcme - Operations Lead\n2019 - 2024\nRan onboarding and wrote standard operating procedures.\n\nSKILLS\nTraining, SOPs, onboarding',
    fileName: 'after-wipe.txt',
    filePath: '',
    fileType: 'pasted'
  })
  check('database still usable afterwards', after.status === 'imported', after.status)
  keeperWindow.destroy()
}

app.whenReady().then(async () => {
  console.log('قُمع smoke test')
  try {
    await run()
  } catch (err) {
    failures++
    console.error('\nUNCAUGHT:', err)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`)
    app.exit(failures === 0 ? 0 : 1)
  }
})
