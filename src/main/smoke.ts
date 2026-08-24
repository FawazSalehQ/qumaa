/**
 * Headless integration check, run inside Electron via `npm run smoke`.
 *
 * Covers exactly the seams the vitest suite cannot: better-sqlite3 under
 * Electron's ABI, the embedding utilityProcess, FTS5/bm25, real PDF and DOCX
 * parsing, and the full ingest → search round trip. Uses a throwaway userData
 * directory so it never touches the real library.
 */
import { app } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
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
  const { getDb, stats } = await import('./db/index.js')
  const { embedder, setEntryDir } = await import('./embed/client.js')
  // Must be the entry file's own __dirname; see setEntryDir's comment.
  setEntryDir(__dirname)
  const { ingestFile, ingestText, collectFiles } = await import('./ingest/pipeline.js')
  const { search } = await import('./search/rank.js')

  console.log('\n1. Database (better-sqlite3 under Electron)')
  getDb()
  check('opens and creates schema', stats().resumeCount === 0)

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
