/**
 * Headless integration check, run inside Electron via `npm run smoke`.
 *
 * Covers exactly the seams the vitest suite cannot: better-sqlite3 under
 * Electron's ABI, the embedding utilityProcess, FTS5/bm25, real PDF and DOCX
 * parsing, and the full ingest → search round trip. Uses a throwaway userData
 * directory so it never touches the real library.
 */
import { app, BrowserWindow } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { Company } from '@shared/recruiting.js'

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

function matchesVector(blob: Buffer, expected: Float32Array, tolerance = 1e-6): boolean {
  if (blob.byteLength !== expected.byteLength) return false
  for (let i = 0; i < expected.length; i++) {
    if (Math.abs(blob.readFloatLE(i * 4) - expected[i]) > tolerance) return false
  }
  return true
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
  const {
    CURRENT_SCHEMA_VERSION,
    DATABASE_LIMITS,
    migrateDatabase,
    PUBLISHED_SCHEMA_V1_SQL,
    QUMAA_APPLICATION_ID
  } = await import('./db/migrations.js')
  const legacyDb = new Database(join(scratch, 'cv_filter.db'))
  legacyDb.exec(PUBLISHED_SCHEMA_V1_SQL)
  legacyDb.close()

  const {
    closeDbForMaintenance,
    dbPath,
    getDb,
    getResumeDetail,
    stats,
    setSetting,
    getSetting,
    deleteResume,
    deleteResumes,
    deleteAllData
  } = await import('./db/index.js')
  const { embedder, setEntryDir } = await import('./embed/client.js')
  const {
    isIndexCommitted,
    markEmptyIndexCurrent,
    needsReindex,
    reindexAll,
    storedModel
  } = await import('./embed/reindex.js')
  const { backfillDocumentVectors, documentVector } = await import('./ingest/duplicates.js')
  const { deriveResumeText } = await import('./ingest/derive.js')
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
  check(
    'adopts legacy libraries with Qumaa application identity',
    getDb().pragma('application_id', { simple: true }) === QUMAA_APPLICATION_ID
  )
  check(
    'records the current numbered schema version',
    getDb().pragma('user_version', { simple: true }) === CURRENT_SCHEMA_VERSION
  )

  for (const publishedVersion of [2, 3]) {
    const fixture = new Database(join(scratch, `published-v${publishedVersion}.db`))
    fixture.exec(PUBLISHED_SCHEMA_V1_SQL)
    fixture.exec('ALTER TABLE resumes ADD COLUMN doc_vector BLOB')
    if (publishedVersion === 3) {
      fixture.exec("ALTER TABLE resumes ADD COLUMN skills_version TEXT NOT NULL DEFAULT ''")
    }
    const migration = migrateDatabase(fixture)
    check(
      `adopts published schema variant ${publishedVersion}`,
      migration.adoptedLegacySchema && migration.toVersion === CURRENT_SCHEMA_VERSION
    )
    fixture.close()
  }
  const freshV3Fixture = new Database(join(scratch, 'published-v3-fresh.db'))
  freshV3Fixture.exec(
    PUBLISHED_SCHEMA_V1_SQL.replace(
      "  skills_json      TEXT NOT NULL DEFAULT '[]',\n  likely_scanned   INTEGER NOT NULL DEFAULT 0",
      "  skills_json      TEXT NOT NULL DEFAULT '[]',\n  skills_version   TEXT NOT NULL DEFAULT '',\n  likely_scanned   INTEGER NOT NULL DEFAULT 0"
    )
  )
  freshV3Fixture.exec('ALTER TABLE resumes ADD COLUMN doc_vector BLOB')
  const freshV3Migration = migrateDatabase(freshV3Fixture)
  check(
    'adopts the alternate column order from fresh published v3 libraries',
    freshV3Migration.adoptedLegacySchema && freshV3Migration.toVersion === CURRENT_SCHEMA_VERSION
  )
  freshV3Fixture.close()

  const { runSchemaSecuritySmoke } = await import('./smoke-security.js')
  runSchemaSecuritySmoke(check, scratch)

  const { RECRUITING_TABLE_SQL, readRecord } = await import('./recruiting/storage.js')
  for (const publishedVersion of [4, 7, 8, 9, 10, 11]) {
    const fixture = new Database(join(scratch, `published-v${publishedVersion}.db`))
    fixture.exec(PUBLISHED_SCHEMA_V1_SQL)
    fixture.exec('ALTER TABLE resumes ADD COLUMN doc_vector BLOB')
    fixture.exec("ALTER TABLE resumes ADD COLUMN skills_version TEXT NOT NULL DEFAULT ''")
    fixture.exec(RECRUITING_TABLE_SQL)
    const legacyJob = {
      id: 'a30da3dc-59a5-4d41-bd24-a1a33972c036',
      posting: { position: 'Legacy vacancy', jobDescription: '', requirements: '', educationAndCertifications: '' },
      status: 'open', criteria: [], createdAt: 1, updatedAt: 1, lastSearchedAt: null
    }
    const legacyV11Company = { id: 'aa03201f-5642-4154-bc04-c6bc36514a29', name: 'Existing company', industry: ['Engineering'], location: ['Riyadh'], website: '', contactName: [], contactEmail: [], note: '', createdAt: 1, updatedAt: 1 }
    const legacyJson = JSON.stringify(publishedVersion === 11 ? { ...legacyJob, companyId: legacyV11Company.id } : legacyJob)
    if (publishedVersion === 11) fixture.prepare("INSERT INTO recruiting_records(kind, id, data) VALUES ('company', ?, ?)").run(legacyV11Company.id, JSON.stringify(legacyV11Company))
    fixture.prepare("INSERT INTO recruiting_records(kind, id, data) VALUES ('job', ?, ?)").run(legacyJob.id, legacyJson)
    fixture.pragma(`application_id = ${QUMAA_APPLICATION_ID}`)
    fixture.pragma(`user_version = ${publishedVersion}`)
    const migration = migrateDatabase(fixture)
    const stored = fixture.prepare("SELECT data FROM recruiting_records WHERE kind = 'job' AND id = ?").get(legacyJob.id) as { data: string }
    check(`upgrades genuine v${publishedVersion} jobs without fabricating company, budget or history`, migration.fromVersion === publishedVersion && migration.toVersion === CURRENT_SCHEMA_VERSION && stored.data === legacyJson)
    if (publishedVersion === 11) check('schema 12 preserves existing company identity and details without creating cost plans', (fixture.prepare("SELECT data FROM recruiting_records WHERE kind = 'company' AND id = ?").get(legacyV11Company.id) as { data: string }).data === JSON.stringify(legacyV11Company) && (fixture.prepare("SELECT COUNT(*) AS count FROM recruiting_records WHERE kind = 'hiringBudget'").get() as { count: number }).count === 0)
    fixture.close()
  }

  const legacyCompanyFixture = new Database(join(scratch, 'published-v10-company.db'))
  legacyCompanyFixture.exec(PUBLISHED_SCHEMA_V1_SQL)
  legacyCompanyFixture.exec('ALTER TABLE resumes ADD COLUMN doc_vector BLOB')
  legacyCompanyFixture.exec("ALTER TABLE resumes ADD COLUMN skills_version TEXT NOT NULL DEFAULT ''")
  legacyCompanyFixture.exec(RECRUITING_TABLE_SQL)
  const legacyCompanyRecord = {
    id: '233315e2-bb3e-4bd4-bd85-94736d7b3776', name: 'Legacy client',
    industry: 'Energy, Construction / Consulting', location: 'الرياض، المملكة العربية السعودية',
    website: '', contactName: 'أحمد / مدير التوظيف', contactEmail: 'first@example.com; second@example.com',
    note: 'Preserve the original relationship', createdAt: 1, updatedAt: 2
  }
  const legacyCompanyJob = {
    id: '297f5f98-9b30-4102-91d0-346feef72c0a', companyId: legacyCompanyRecord.id,
    posting: { position: 'Legacy company vacancy', jobDescription: '', requirements: '', educationAndCertifications: '' },
    status: 'open', criteria: [], createdAt: 1, updatedAt: 1, lastSearchedAt: null
  }
  const legacyCompanyJson = JSON.stringify(legacyCompanyRecord)
  const legacyCompanyJobJson = JSON.stringify(legacyCompanyJob)
  legacyCompanyFixture.prepare("INSERT INTO recruiting_records(kind, id, data) VALUES ('company', ?, ?)").run(legacyCompanyRecord.id, legacyCompanyJson)
  legacyCompanyFixture.prepare("INSERT INTO recruiting_records(kind, id, data) VALUES ('job', ?, ?)").run(legacyCompanyJob.id, legacyCompanyJobJson)
  legacyCompanyFixture.pragma(`application_id = ${QUMAA_APPLICATION_ID}`)
  legacyCompanyFixture.pragma('user_version = 10')
  const companyMigration = migrateDatabase(legacyCompanyFixture)
  const normalizedLegacyCompany = readRecord<Company>(legacyCompanyFixture, 'company', legacyCompanyRecord.id)!
  check('v10 company details normalize to whole-value lists on read without changing identity', companyMigration.fromVersion === 10 && companyMigration.toVersion === CURRENT_SCHEMA_VERSION && normalizedLegacyCompany.id === legacyCompanyRecord.id && normalizedLegacyCompany.createdAt === 1 && normalizedLegacyCompany.updatedAt === 2 && normalizedLegacyCompany.industry.length === 1 && normalizedLegacyCompany.industry[0] === legacyCompanyRecord.industry && normalizedLegacyCompany.location[0] === legacyCompanyRecord.location && normalizedLegacyCompany.contactName[0] === legacyCompanyRecord.contactName && normalizedLegacyCompany.contactEmail[0] === legacyCompanyRecord.contactEmail)
  check('v10 company migration preserves raw records and linked job identities verbatim', (legacyCompanyFixture.prepare("SELECT data FROM recruiting_records WHERE kind = 'company' AND id = ?").get(legacyCompanyRecord.id) as { data: string }).data === legacyCompanyJson && (legacyCompanyFixture.prepare("SELECT data FROM recruiting_records WHERE kind = 'job' AND id = ?").get(legacyCompanyJob.id) as { data: string }).data === legacyCompanyJobJson)
  legacyCompanyFixture.close()

  // SQLite length(TEXT) stops at U+0000. This tail is larger than the logical
  // character limit but remains inside the UTF-8 storage budget, so the bounded
  // scalar NUL preflight—not a JavaScript row read—must reject it.
  const nulTailText =
    'Visible Candidate\0' + 'z'.repeat(DATABASE_LIMITS.rawTextCharsPerResume * 2)
  const nulStartupPath = join(scratch, 'published-v1-nul-tail.db')
  const nulStartup = new Database(nulStartupPath)
  nulStartup.exec(PUBLISHED_SCHEMA_V1_SQL)
  nulStartup
    .prepare(
      `INSERT INTO resumes
         (file_path, file_name, content_hash, file_type, imported_at, raw_text,
          skills_json, likely_scanned)
       VALUES ('', 'Nul.md', ?, 'md', 1, ?, '[]', 0)`
    )
    .run('b'.repeat(64), nulTailText)
  const nulLengths = nulStartup
    .prepare(
      `SELECT length(raw_text) AS textChars,
              length(CAST(raw_text AS BLOB)) AS storageBytes
       FROM resumes`
    )
    .get() as { textChars: number; storageBytes: number }
  let nulStartupRejection = ''
  try {
    migrateDatabase(nulStartup)
  } catch (error) {
    nulStartupRejection = String(error)
  }
  const nulStartupColumns = new Set(
    (nulStartup.prepare('PRAGMA table_info(resumes)').all() as Array<{ name: string }>).map(
      ({ name }) => name
    )
  )
  check(
    'detects a large tail hidden by SQLite embedded-NUL length semantics',
    nulLengths.textChars === 'Visible Candidate'.length &&
      nulLengths.storageBytes > DATABASE_LIMITS.rawTextCharsPerResume &&
      nulStartupRejection.includes('embedded NUL character')
  )
  check(
    'rejects a NUL-tail library before stamping or altering it',
    nulStartup.pragma('application_id', { simple: true }) === 0 &&
      nulStartup.pragma('user_version', { simple: true }) === 0 &&
      !nulStartupColumns.has('doc_vector')
  )
  nulStartup.close()

  const populatedLegacyFixture = new Database(join(scratch, 'published-v1-populated.db'))
  populatedLegacyFixture.exec(PUBLISHED_SCHEMA_V1_SQL)
  populatedLegacyFixture
    .prepare(
      `INSERT INTO resumes
         (file_path, file_name, content_hash, file_type, imported_at, raw_text,
          name, skills_json, likely_scanned)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 0)`
    )
    .run(
      '/legacy/Candidate.md',
      'Candidate.md',
      'a'.repeat(64),
      'md',
      1_700_000_000_000,
      'Legacy Candidate\n\nWORK EXPERIENCE\nBuilt reliable systems for five years.',
      'Legacy Candidate'
    )
  populatedLegacyFixture
    .prepare(
      `INSERT INTO chunks (resume_id, section, ordinal, text, embedding)
       VALUES (1, 'experience', 0, 'Built reliable systems for five years.', zeroblob(?))`
    )
    .run(384 * Float32Array.BYTES_PER_ELEMENT)
  migrateDatabase(populatedLegacyFixture)
  const preservedLegacy = populatedLegacyFixture
    .prepare(
      `SELECT raw_text AS rawText, name,
              (SELECT COUNT(*) FROM chunks WHERE resume_id = resumes.id) AS chunks
       FROM resumes WHERE id = 1`
    )
    .get() as { rawText: string; name: string; chunks: number }
  check(
    'upgrades a populated beta database without losing resume data',
    preservedLegacy.name === 'Legacy Candidate' &&
      preservedLegacy.rawText.includes('Built reliable systems') &&
      preservedLegacy.chunks === 1
  )
  populatedLegacyFixture.close()
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

  const countBeforeNulIngest = stats().resumeCount
  const nulIngest = await ingestText({
    text: 'Candidate\0hidden content',
    fileName: 'NUL candidate (pasted)',
    filePath: '',
    fileType: 'pasted'
  })
  check(
    'rejects embedded NUL during standard ingest without changing the library',
    nulIngest.status === 'failed' &&
      nulIngest.reason.includes('unsupported NUL character') &&
      stats().resumeCount === countBeforeNulIngest
  )
  const controlLabelIngest = await ingestText({
    text: 'Unique Candidate\n\nEXPERIENCE\nBuilt safe import validation.',
    fileName: 'Candidate\0hidden label',
    filePath: '',
    fileType: 'pasted'
  })
  check(
    'rejects a control character in the central persisted-label path',
    controlLabelIngest.status === 'failed' &&
      controlLabelIngest.reason.includes('control characters') &&
      stats().resumeCount === countBeforeNulIngest
  )

  // Simulate opening a library whose vectors came from another model. Direct
  // ingestion must never overwrite this library-wide marker; production holds
  // ingestion behind the readiness barrier until the migration below finishes.
  setSetting('embeddingModel', 'legacy-model')

  console.log('\n5a. Concurrent identical imports')
  const twinText = 'Concurrent Twin\nRiyadh\n\nEXPERIENCE\nAcme — Analyst\nJan 2020 - Dec 2023\nPrepared financial models and quarterly forecasts for retail and logistics clients.'
  const twins = await Promise.all([
    ingestText({ text: twinText, fileName: 'twin-a.md', filePath: '/fictional-originals/twin-a.md', fileType: 'md' }),
    ingestText({ text: twinText, fileName: 'twin-b.md', filePath: '/fictional-originals/twin-b.md', fileType: 'md' })
  ])
  check('two concurrent imports of the same text yield one import and one duplicate', twins.map((outcome) => outcome.status).sort().join(',') === 'duplicate,imported')
  const twin = twins.find((outcome) => outcome.status === 'imported')
  check('the concurrent twin can be removed again', twin !== undefined && twin.status === 'imported' && deleteResume({ id: twin.resume.id, recordKey: twin.resume.recordKey }))

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
  const detail = getResumeDetail({ id: top.resume.id, recordKey: top.resume.recordKey })
  check(
    'loads resume text with its indexed-passage count',
    detail !== null && detail.rawText.includes('Maria Chen') && detail.passageCount > 0,
    detail ? `${detail.passageCount} passages` : 'missing detail'
  )
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

  console.log('\n7a. Persistent recruiter workspaces')
  const recruiting = await import('./recruiting/index.js')
  const { emptyProfile } = await import('./recruiting/planning.js')
  const { searchSessions } = await import('./search/sessions.js')
  const posting = { position: 'Backend Engineer', jobDescription: 'Build Python services and operate Kubernetes clusters.', requirements: 'PostgreSQL and AWS', educationAndCertifications: '' }
  const companyInput = { name: 'شركة طاقة', industry: 'Energy', location: 'الدمام', website: 'example.com', contactName: 'أحمد', contactEmail: 'recruiter@example.com', note: 'Call next month about the regional engineering team.' }
  const clientCompany = recruiting.saveCompany(companyInput)
  check('legacy company save callers receive canonical lists for every detail field', clientCompany.industry.join('|') === companyInput.industry && clientCompany.location.join('|') === companyInput.location && clientCompany.contactName.join('|') === companyInput.contactName && clientCompany.contactEmail.join('|') === companyInput.contactEmail)
  const companyDetailFields = ['industry', 'location', 'contactName', 'contactEmail'] as const
  const companyDetails = { industry: ['Energy', 'Renewable Energy'], location: ['الدمام', 'Riyadh'], contactName: ['أحمد', 'Dana Lee'], contactEmail: ['recruiter@example.com', 'hiring@example.com'] }
  const editedCompany = recruiting.saveCompany({ ...companyInput, ...companyDetails, id: clientCompany.id, note: 'Client confirmed the role budget.' })
  const sourceCompany = recruiting.saveCompany({ ...companyInput, name: 'Platform Services', contactName: '', contactEmail: '', note: 'Research source company.' })
  // A migrated library may retain untouched legacy JSON beside new array-valued records.
  const rawLegacySourceCompany = { ...sourceCompany, industry: companyInput.industry, location: companyInput.location, contactName: '', contactEmail: '' }
  getDb().prepare("UPDATE recruiting_records SET data = ? WHERE kind = 'company' AND id = ?").run(JSON.stringify(rawLegacySourceCompany), sourceCompany.id)
  const initialBudget = { min: 15_000.25, max: 25_000.75, currency: 'SAR', period: 'monthly' as const }
  const totalHiringBudget = { min: 50_000, max: 75_000, currency: 'SAR' }
  check('creates and edits companies with stable identity and monotonic dates', recruiting.listCompanies().length === 2 && editedCompany.id === clientCompany.id && editedCompany.createdAt === clientCompany.createdAt && editedCompany.updatedAt > clientCompany.updatedAt && recruiting.listCompanies().find((company) => company.id === clientCompany.id)?.note === editedCompany.note)
  check('persists multiple company industries, locations, contact names and emails in order', companyDetailFields.every((field) => JSON.stringify(editedCompany[field]) === JSON.stringify(companyDetails[field])))
  const savedJob = recruiting.saveJob({ posting, status: 'open', criteria: [{ id: 'python', text: 'Python services', importance: 'required' }], companyId: clientCompany.id, budget: initialBudget, hiringBudget: totalHiringBudget })
  const otherJob = recruiting.saveJob({ posting: { ...posting, position: 'Future vacancy' }, status: 'open', criteria: [] })
  check('persists multiple independent job drafts', recruiting.listJobs().length === 2 && recruiting.getJob(savedJob.id).response === null)
  check('associates the hiring company, salary range and total hiring budget with only its own job', savedJob.companyId === clientCompany.id && JSON.stringify(savedJob.budget) === JSON.stringify(initialBudget) && JSON.stringify(savedJob.hiringBudget) === JSON.stringify(totalHiringBudget) && otherJob.companyId === undefined && otherJob.budget === undefined && otherJob.hiringBudget === undefined)
  check('new jobs record their initial status at creation', savedJob.statusHistory?.length === 1 && savedJob.statusHistory[0].kind === 'created' && savedJob.statusHistory[0].status === 'open' && savedJob.statusHistory[0].at === savedJob.createdAt)
  const heldJob = recruiting.changeJobStatus({ jobId: otherJob.id, expectedUpdatedAt: otherJob.updatedAt, status: 'on-hold' }).job
  check('status changes append a timestamp without replacing creation', heldJob.statusHistory?.length === 2 && heldJob.statusHistory[1].status === 'on-hold' && heldJob.statusHistory[1].kind === 'status-changed' && heldJob.statusHistory[1].at > otherJob.createdAt && heldJob.createdAt === otherJob.createdAt)
  const sameHeldJob = recruiting.changeJobStatus({ jobId: otherJob.id, expectedUpdatedAt: heldJob.updatedAt, status: 'on-hold' }).job
  check('reselecting the current status creates no artificial history', sameHeldJob.updatedAt === heldJob.updatedAt && sameHeldJob.statusHistory?.length === 2)
  let statusBypassRejected = false
  try { recruiting.saveJob({ id: otherJob.id, posting: otherJob.posting, status: 'filled', criteria: [] }) } catch { statusBypassRejected = true }
  check('posting edits cannot bypass the filled-job requirements', statusBypassRejected && recruiting.getJob(otherJob.id).job.status === 'on-hold')
  const { temporarySearch } = await import('./recruiting/temporary.js')
  const recordsBeforeTemporary = (getDb().prepare('SELECT COUNT(*) AS count FROM recruiting_records').get() as { count: number }).count
  const temporary = await recruiting.searchTemporary({ posting, status: 'open', criteria: [], companyId: clientCompany.id, budget: initialBudget, hiringBudget: totalHiringBudget })
  const temporaryRef = { jobId: temporary.job.id, sessionId: temporary.response!.sessionId }
  check('temporary matching creates no saved job or snapshot', temporary.temporary === true && temporary.response!.results.length === stats().resumeCount && (getDb().prepare('SELECT COUNT(*) AS count FROM recruiting_records').get() as { count: number }).count === recordsBeforeTemporary)
  let temporaryReviewRejected = false
  try { recruiting.saveReview({ jobId: temporary.job.id, resume: { id: top.resume.id, recordKey: top.resume.recordKey }, status: 'shortlisted', note: 'Must not become an orphan', order: 0, assessments: [] }) } catch { temporaryReviewRejected = true }
  check('temporary searches cannot create orphaned recruiter reviews', temporaryReviewRejected && (getDb().prepare("SELECT COUNT(*) AS count FROM recruiting_records WHERE kind = 'review'").get() as { count: number }).count === 0)
  check('temporary exports use the canonical top three', recruiting.getTemporaryExport(temporaryRef).results.map((result) => result.resume.recordKey).join(',') === temporary.response!.results.slice(0, 3).map((result) => result.resume.recordKey).join(','))
  const temporaryReranked = recruiting.saveJobRerank(temporaryRef, [...temporary.response!.results].reverse().map((result) => ({ ...result, llmReason: 'Temporary candidate evidence.' })), { provider: 'openai', model: 'gpt-6-astra' })
  check('temporary reranking remains entirely in memory', temporaryReranked.temporary === true && temporaryReranked.response!.reranked === true && (getDb().prepare('SELECT COUNT(*) AS count FROM recruiting_records').get() as { count: number }).count === recordsBeforeTemporary)
  // Claude sessions can expire or be evicted while this unsaved workspace stays open.
  searchSessions.clear()
  let expiredTemporaryClaudeRejected = false
  try { recruiting.jobRerankSource({ jobId: temporaryReranked.job.id, sessionId: temporaryReranked.response!.sessionId }) } catch { expiredTemporaryClaudeRejected = true }
  check('retaining temporary results does not extend Claude session authority', expiredTemporaryClaudeRejected)
  check('temporary export survives expiry of the Claude session cache', recruiting.getTemporaryExport({ jobId: temporaryReranked.job.id, sessionId: temporaryReranked.response!.sessionId }).results[0].resume.recordKey === temporaryReranked.response!.results[0].resume.recordKey)
  const temporarySaved = recruiting.saveTemporary({ jobId: temporaryReranked.job.id, sessionId: temporaryReranked.response!.sessionId })
  check('explicit save preserves exact temporary posting, results and Claude reasons', temporarySaved.temporary === false && temporarySaved.job.id !== temporary.job.id && JSON.stringify(temporarySaved.job.posting) === JSON.stringify(posting) && JSON.stringify(temporarySaved.response!.results) === JSON.stringify(temporaryReranked.response!.results) && temporarySearch.id === null)
  check('saving Express results starts history at the actual save time', temporarySaved.job.statusHistory?.length === 1 && temporarySaved.job.statusHistory[0].kind === 'created' && temporarySaved.job.statusHistory[0].at === temporarySaved.job.createdAt && temporarySaved.job.createdAt >= temporary.job.createdAt)
  check('saving Express results retains the actual reranking provider and model', temporarySaved.response?.rerankConfig?.provider === 'openai' && temporarySaved.response.rerankConfig.model === 'gpt-6-astra')
  check('saving Express results preserves its hiring company, salary and total hiring budget', temporarySaved.job.companyId === clientCompany.id && JSON.stringify(temporarySaved.job.budget) === JSON.stringify(initialBudget) && JSON.stringify(temporarySaved.job.hiringBudget) === JSON.stringify(totalHiringBudget))
  let promotedCapabilityRejected = false
  try { recruiting.jobRerankSource(temporaryRef) } catch { promotedCapabilityRejected = true }
  check('promotion revokes temporary capabilities without addressing the saved job', promotedCapabilityRejected)
  const concurrentTemporary = await Promise.allSettled([
    recruiting.searchTemporary({ posting, status: 'open', criteria: [] }),
    recruiting.searchTemporary({ posting: { ...posting, position: 'Most recent temporary search' }, status: 'open', criteria: [] })
  ])
  check('a late temporary search cannot overwrite a newer request', concurrentTemporary[0].status === 'rejected' && concurrentTemporary[1].status === 'fulfilled')
  const currentTemporary = concurrentTemporary[1].status === 'fulfilled' ? concurrentTemporary[1].value : null
  recruiting.discardTemporary(temporary.job.id)
  check('an obsolete discard preserves the current temporary and all saved jobs', currentTemporary !== null && temporarySearch.id === currentTemporary.job.id && recruiting.getJob(temporarySaved.job.id).response!.reranked === true)
  if (currentTemporary) recruiting.discardTemporary(currentTemporary.job.id)
  check('discard removes only temporary search state', temporarySearch.id === null && recruiting.listJobs().length === 3)
  const workspace = await recruiting.searchJob(savedJob.id)
  check('ranks the complete local library for a saved job', workspace.response?.results.length === stats().resumeCount)
  const selectedResume = top.resume
  recruiting.saveReview({ jobId: savedJob.id, resume: { id: selectedResume.id, recordKey: selectedResume.recordKey }, status: 'shortlisted', note: 'Arrange technical interview', order: -0.5, assessments: [{ criterionId: 'python', status: 'confirmed', note: 'Discussed during screening' }] })
  recruiting.saveReview({ jobId: otherJob.id, resume: { id: selectedResume.id, recordKey: selectedResume.recordKey }, status: 'maybe', note: 'Keep in talent pool', order: 0, assessments: [] })
  const profileInput = { ...emptyProfile(selectedResume.recordKey), name: 'Maria Chen (confirmed)', expectedSalary: 'SAR 22000', note: 'Recruiter profile note' }
  const { candidateKey: _candidateKey, recordKeys: _recordKeys, updatedAt: _updatedAt, ...profileFields } = profileInput
  recruiting.saveProfile({ resume: { id: selectedResume.id, recordKey: selectedResume.recordKey }, ...profileFields })
  check('keeps job decisions independent', recruiting.getJob(otherJob.id).reviews[0].status === 'maybe' && recruiting.getJob(savedJob.id).reviews[0].status === 'shortlisted')
  check('keeps recruiter corrections separate from CV extraction', recruiting.getJob(savedJob.id).response?.results.find((result) => result.resume.recordKey === selectedResume.recordKey)?.resume.name === selectedResume.name)

  const beforeCompanyMetadata = recruiting.getJob(savedJob.id)
  const snapshotBeforeCompanyMetadata = (getDb().prepare("SELECT data FROM recruiting_records WHERE kind = 'snapshot' AND id = ?").get(savedJob.id) as { data: string }).data
  const updatedBudget = { ...initialBudget, max: 28_000.75 }
  const budgetedJob = recruiting.saveJob({ id: savedJob.id, posting, status: 'open', criteria: savedJob.criteria, budget: updatedBudget })
  check('editing the salary range preserves the independent total hiring budget', JSON.stringify(budgetedJob.budget) === JSON.stringify(updatedBudget) && JSON.stringify(budgetedJob.hiringBudget) === JSON.stringify(totalHiringBudget))
  const mappedTargets = [{ companyId: sourceCompany.id, status: 'researching' as const, focusRoles: 'Platform backend engineers', note: 'Map regional engineering leadership.' }]
  const mappedWorkspace = recruiting.saveTargetCompanies({ jobId: savedJob.id, expectedUpdatedAt: budgetedJob.updatedAt, companies: mappedTargets })
  check('keeps per-job target research separate from the hiring company', mappedWorkspace.job.companyId === clientCompany.id && JSON.stringify(mappedWorkspace.job.targetCompanies) === JSON.stringify(mappedTargets) && recruiting.getJob(otherJob.id).job.targetCompanies === undefined)
  check('company, budget and map edits preserve exact rankings, fingerprints, history and reviews', !mappedWorkspace.job.stale && JSON.stringify(mappedWorkspace.response?.results) === JSON.stringify(beforeCompanyMetadata.response?.results) && JSON.stringify(mappedWorkspace.reviews) === JSON.stringify(beforeCompanyMetadata.reviews) && JSON.stringify(mappedWorkspace.job.statusHistory) === JSON.stringify(beforeCompanyMetadata.job.statusHistory) && (getDb().prepare("SELECT data FROM recruiting_records WHERE kind = 'snapshot' AND id = ?").get(savedJob.id) as { data: string }).data === snapshotBeforeCompanyMetadata)
  const validMetadataRecord = (getDb().prepare("SELECT data FROM recruiting_records WHERE kind = 'job' AND id = ?").get(savedJob.id) as { data: string }).data
  const unknownCompanyId = '689af5c4-3b85-4524-858b-946e1572dfbc'
  const invalidMetadataEdits = [
    () => recruiting.saveJob({ id: savedJob.id, posting, status: 'open', criteria: savedJob.criteria, companyId: unknownCompanyId }),
    () => recruiting.saveJob({ id: savedJob.id, posting, status: 'open', criteria: savedJob.criteria, companyId: sourceCompany.id }),
    () => recruiting.saveJob({ id: savedJob.id, posting, status: 'open', criteria: savedJob.criteria, budget: { ...updatedBudget, min: updatedBudget.max + 1 } }),
    () => recruiting.saveJob({ id: savedJob.id, posting, status: 'open', criteria: savedJob.criteria, hiringBudget: { ...totalHiringBudget, min: totalHiringBudget.max + 1 } }),
    () => recruiting.saveJob({ id: savedJob.id, posting, status: 'open', criteria: savedJob.criteria, hiringBudget: { ...totalHiringBudget, max: Infinity } }),
    () => recruiting.saveTargetCompanies({ jobId: savedJob.id, expectedUpdatedAt: mappedWorkspace.job.updatedAt, companies: [{ ...mappedTargets[0], companyId: unknownCompanyId }] }),
    () => recruiting.saveTargetCompanies({ jobId: savedJob.id, expectedUpdatedAt: mappedWorkspace.job.updatedAt, companies: [{ ...mappedTargets[0], companyId: clientCompany.id }] }),
    () => recruiting.saveTargetCompanies({ jobId: savedJob.id, expectedUpdatedAt: budgetedJob.updatedAt, companies: [] })
  ].map((edit) => { try { edit(); return false } catch { return true } })
  check('rejects unknown companies, self-targets, reversed budgets and stale maps without writing', invalidMetadataEdits.every(Boolean) && (getDb().prepare("SELECT data FROM recruiting_records WHERE kind = 'job' AND id = ?").get(savedJob.id) as { data: string }).data === validMetadataRecord)
  const omittedMetadata = recruiting.saveJob({ id: savedJob.id, posting, status: 'open', criteria: savedJob.criteria })
  check('older job editors preserve omitted company, salary, hiring budget and target fields', omittedMetadata.companyId === clientCompany.id && JSON.stringify(omittedMetadata.budget) === JSON.stringify(updatedBudget) && JSON.stringify(omittedMetadata.hiringBudget) === JSON.stringify(totalHiringBudget) && JSON.stringify(omittedMetadata.targetCompanies) === JSON.stringify(mappedTargets))
  const clearedMetadata = recruiting.saveJob({ id: savedJob.id, posting, status: 'open', criteria: savedJob.criteria, companyId: null, budget: null, hiringBudget: null, targetCompanies: [] })
  check('explicit clearing removes job company, salary, hiring budget and targets without deleting company records', clearedMetadata.companyId === null && clearedMetadata.budget === null && clearedMetadata.hiringBudget === null && clearedMetadata.targetCompanies?.length === 0 && recruiting.listCompanies().length === 2)
  recruiting.saveJob({ id: savedJob.id, posting, status: 'open', criteria: savedJob.criteria, companyId: clientCompany.id, budget: updatedBudget, hiringBudget: totalHiringBudget, targetCompanies: mappedTargets })
  const hiringRefs = workspace.response!.results.slice(0, 3).map(({ resume }) => ({ id: resume.id, recordKey: resume.recordKey }))
  const fillInput = { jobId: otherJob.id, expectedUpdatedAt: heldJob.updatedAt, status: 'filled' as const }
  const rejectedPlacements = [
    undefined,
    { hired: { ...hiringRefs[0], recordKey: '0'.repeat(64) } },
    { hired: hiringRefs[0], backup2: hiringRefs[0] },
    { hired: hiringRefs[0], backup3: hiringRefs[2] }
  ].map((placement) => {
    try { recruiting.changeJobStatus({ ...fillInput, placement }); return false } catch { return true }
  })
  check('filled jobs require a valid hire and distinct consecutive backup slots', rejectedPlacements.every(Boolean) && recruiting.getJob(otherJob.id).job.statusHistory?.length === 2)
  const placement = { hired: hiringRefs[0], backup2: hiringRefs[1], backup3: hiringRefs[2] }
  const filledJob = recruiting.changeJobStatus({ ...fillInput, placement }).job
  check('records a hire and both backup CV identities in status history', filledJob.status === 'filled' && filledJob.placement?.hired.recordKey === hiringRefs[0].recordKey && filledJob.placement.backup2?.recordKey === hiringRefs[1].recordKey && filledJob.placement.backup3?.recordKey === hiringRefs[2].recordKey && JSON.stringify(filledJob.statusHistory?.at(-1)?.placement) === JSON.stringify(filledJob.placement))
  let staleStatusRejected = false
  try { recruiting.changeJobStatus({ jobId: otherJob.id, expectedUpdatedAt: heldJob.updatedAt, status: 'archived' }) } catch { staleStatusRejected = true }
  check('stale status dialogs cannot overwrite a later hiring decision', staleStatusRejected && recruiting.getJob(otherJob.id).job.status === 'filled')
  const sameFilledJob = recruiting.changeJobStatus({ ...fillInput, expectedUpdatedAt: filledJob.updatedAt, placement }).job
  check('saving identical hiring selections creates no duplicate history', sameFilledJob.statusHistory?.length === filledJob.statusHistory?.length && sameFilledJob.updatedAt === filledJob.updatedAt)
  const adjustedFilledJob = recruiting.changeJobStatus({ ...fillInput, expectedUpdatedAt: filledJob.updatedAt, placement: { hired: hiringRefs[0] } }).job
  check('editing a filled job records a hiring update without another status change', adjustedFilledJob.statusHistory?.at(-1)?.kind === 'placement-updated' && adjustedFilledJob.placement?.backup2 === null && adjustedFilledJob.placement.backup3 === null)
  const archivedJob = recruiting.changeJobStatus({ jobId: otherJob.id, expectedUpdatedAt: adjustedFilledJob.updatedAt, status: 'archived' }).job
  check('archiving retains the previous hiring outcome and recruiter review', archivedJob.placement?.hired.recordKey === hiringRefs[0].recordKey && recruiting.getJob(otherJob.id).reviews[0].note === 'Keep in talent pool')
  // Simulate a released job whose current status predates status-history support.
  const legacyRecord = JSON.parse((getDb().prepare("SELECT data FROM recruiting_records WHERE kind = 'job' AND id = ?").get(otherJob.id) as { data: string }).data)
  delete legacyRecord.statusHistory
  delete legacyRecord.placement
  legacyRecord.status = 'filled'
  getDb().prepare("UPDATE recruiting_records SET data = ? WHERE kind = 'job' AND id = ?").run(JSON.stringify(legacyRecord), otherJob.id)
  check('legacy jobs do not acquire invented transition dates', recruiting.getJob(otherJob.id).job.statusHistory === undefined && recruiting.getJob(otherJob.id).job.createdAt === otherJob.createdAt)
  const repairedLegacyJob = recruiting.changeJobStatus({ jobId: otherJob.id, expectedUpdatedAt: legacyRecord.updatedAt, status: 'filled', placement: { hired: hiringRefs[0] } }).job
  check('legacy filled jobs can record their missing hire with an honest update date', repairedLegacyJob.statusHistory?.length === 1 && repairedLegacyJob.statusHistory[0].kind === 'placement-updated' && repairedLegacyJob.statusHistory[0].at > legacyRecord.updatedAt && repairedLegacyJob.createdAt === otherJob.createdAt)
  const suggested = (await recruiting.getEvidence({ jobId: savedJob.id, resumes: [{ id: selectedResume.id, recordKey: selectedResume.recordKey }] }))[selectedResume.recordKey][0].passage
  // Passage windows intentionally normalise whitespace while chunking. Check
  // the stored canonical passage, not the PDF extractor's original line breaks.
  const canonicalPassages = getDb().prepare('SELECT text FROM chunks WHERE resume_id = ?').all(selectedResume.id) as Array<{ text: string }>
  check('loads criterion suggestions from canonical CV passages', suggested !== null && canonicalPassages.some((passage) => passage.text.includes(suggested.text)))
  let staleReviewRejected = false
  try { recruiting.saveReview({ jobId: savedJob.id, resume: { id: selectedResume.id, recordKey: '0'.repeat(64) }, status: 'maybe', note: '', order: 0, assessments: [] }) } catch { staleReviewRejected = true }
  check('rejects stale id/hash combinations for recruiter decisions', staleReviewRejected)
  let foreignCriterionRejected = false
  try { recruiting.saveReview({ jobId: savedJob.id, resume: { id: selectedResume.id, recordKey: selectedResume.recordKey }, status: 'maybe', note: '', order: 0, assessments: [{ criterionId: 'foreign', status: 'confirmed', note: '' }] }) } catch { foreignCriterionRejected = true }
  check('rejects assessments for another job’s criterion', foreignCriterionRejected)
  // Restart the current library without relabelling new records as an older schema.
  closeDbForMaintenance()
  const reopenedWorkspace = recruiting.getJob(savedJob.id)
  check('reopens the current schema without losing saved work', getDb().pragma('user_version', { simple: true }) === CURRENT_SCHEMA_VERSION)
  check('reopens saved results and recruiter work after a database restart', reopenedWorkspace.response !== null && reopenedWorkspace.reviews[0].note === 'Arrange technical interview' && reopenedWorkspace.profiles[0].expectedSalary === 'SAR 22000' && !reopenedWorkspace.job.stale)
  check('reopens companies, salary ranges, hiring budgets and target maps after a database restart', JSON.stringify(recruiting.listCompanies().find((company) => company.id === clientCompany.id)) === JSON.stringify(editedCompany) && reopenedWorkspace.job.companyId === clientCompany.id && JSON.stringify(reopenedWorkspace.job.budget) === JSON.stringify(updatedBudget) && JSON.stringify(reopenedWorkspace.job.hiringBudget) === JSON.stringify(totalHiringBudget) && JSON.stringify(reopenedWorkspace.job.targetCompanies) === JSON.stringify(mappedTargets))
  check('reconstructs trusted search sessions from canonical stored CV rows', searchSessions.get(reopenedWorkspace.response!.sessionId).response.results.find((result) => result.resume.recordKey === selectedResume.recordKey)?.resume.name === selectedResume.name)

  const rerankRef = { jobId: savedJob.id, sessionId: reopenedWorkspace.response!.sessionId }
  let wrongJobRejected = false
  try { recruiting.jobRerankSource({ ...rerankRef, jobId: otherJob.id }) } catch { wrongJobRejected = true }
  check('binds Claude sessions to their saved job', wrongJobRejected)
  const reversed = [...reopenedWorkspace.response!.results].reverse().map((result) => ({ ...result, llmReason: 'Relevant production experience.' }))
  const rerankedWorkspace = recruiting.saveJobRerank(rerankRef, reversed, { provider: 'anthropic', model: 'claude-fable-5-1' })
  check('stores Claude order while preserving original scores and recruiter decisions', rerankedWorkspace.response!.reranked === true && rerankedWorkspace.response!.results.every((result, index) => result.resume.recordKey === reversed[index].resume.recordKey && result.score === reversed[index].score) && rerankedWorkspace.reviews[0].note === 'Arrange technical interview')
  let replacedSnapshotRejected = false
  try { recruiting.saveJobRerank(rerankRef, reversed) } catch { replacedSnapshotRejected = true }
  check('rejects a late rerank result for a replaced snapshot', replacedSnapshotRejected)
  closeDbForMaintenance()
  const reopenedRerank = recruiting.getJob(savedJob.id)
  check('reopens saved Claude order and reasons after restarting the database', reopenedRerank.response!.reranked === true && reopenedRerank.response!.results[0].resume.recordKey === reversed[0].resume.recordKey && reopenedRerank.response!.results[0].llmReason === 'Relevant production experience.')
  check('reopens the saved reranking model independently of current preferences', reopenedRerank.response?.rerankConfig?.provider === 'anthropic' && reopenedRerank.response.rerankConfig.model === 'claude-fable-5-1')

  const versionOutcome = await ingestText({ text: `${detail!.rawText}\n\nPROJECTS\n2026: Led a Python platform migration and Kubernetes training for thirty engineers.`, fileName: 'maria-updated.md', filePath: '', fileType: 'pasted' })
  if (versionOutcome.status !== 'imported' && versionOutcome.status !== 'near-duplicate') throw new Error('Could not create the CV-version smoke fixture.')
  const newerResume = versionOutcome.resume
  check('discovers new arrivals for previously searched jobs', recruiting.listJobs().find((job) => job.id === savedJob.id)?.newResumeCount === 1 && recruiting.getJob(savedJob.id).job.stale)
  let staleRerankRejected = false
  const staleRerank = recruiting.getJob(savedJob.id)
  try { recruiting.jobRerankSource({ jobId: savedJob.id, sessionId: staleRerank.response!.sessionId }) } catch { staleRerankRejected = true }
  check('rejects even newly opened Claude sessions when saved matches are stale', staleRerankRejected)
  let staleExportRejected = false
  try { recruiting.getShortlistExport(savedJob.id) } catch { staleExportRejected = true }
  check('requires refreshed rankings before exporting changed libraries', staleExportRejected)
  const primaryRef = { id: selectedResume.id, recordKey: selectedResume.recordKey }
  const versionRef = { id: newerResume.id, recordKey: newerResume.recordKey }
  recruiting.linkVersions({ primary: primaryRef, version: versionRef })
  let linkedHireRejected = false
  try { recruiting.changeJobStatus({ jobId: otherJob.id, expectedUpdatedAt: repairedLegacyJob.updatedAt, status: 'filled', placement: { hired: primaryRef, backup2: versionRef } }) } catch { linkedHireRejected = true }
  check('two linked CV versions cannot fill separate hiring slots', linkedHireRejected)
  const linkedWorkspace = await recruiting.searchJob(savedJob.id)
  check('refreshing local matches clears saved Claude order and reasons', linkedWorkspace.response!.reranked === false && linkedWorkspace.response!.results.every((result) => !result.llmReason))
  check('local refresh clears the previous AI model attribution', linkedWorkspace.response?.rerankConfig === undefined)
  check('deduplicates versions using the latest CV while preserving reviews', linkedWorkspace.response?.results.some((result) => result.resume.recordKey === newerResume.recordKey) === true && !linkedWorkspace.response.results.some((result) => result.resume.recordKey === selectedResume.recordKey) && linkedWorkspace.job.shortlistCount === 1)
  const linkedExport = recruiting.getShortlistExport(savedJob.id)
  check('exports the selected candidate with profile corrections and job notes', linkedExport.results.length === 1 && linkedExport.results[0].resume.recordKey === newerResume.recordKey && linkedExport.results[0].resume.name === 'Maria Chen (confirmed)' && linkedExport.notes[newerResume.recordKey] === 'Arrange technical interview')
  recruiting.unlinkVersion({ resume: versionRef })
  check('unlinking retains recruiter history for both resulting profiles', recruiting.getJob(savedJob.id).job.shortlistCount === 2 && recruiting.listProfiles().filter((profile) => profile.note === 'Recruiter profile note').length === 2)
  recruiting.reorderShortlist({ jobId: savedJob.id, resumes: [versionRef, primaryRef] })
  check('atomically orders selected export candidates', recruiting.getShortlistExport(savedJob.id).results.map((result) => result.resume.recordKey).join(',') === [versionRef.recordKey, primaryRef.recordKey].join(','))
  const shortlistBeforeRerank = recruiting.getShortlistExport(savedJob.id)
  const shortlistWorkspace = recruiting.getJob(savedJob.id)
  recruiting.saveJobRerank({ jobId: savedJob.id, sessionId: shortlistWorkspace.response!.sessionId }, [...shortlistWorkspace.response!.results].reverse())
  check('Claude candidate order leaves the manually ordered shortlist unchanged', JSON.stringify(recruiting.getShortlistExport(savedJob.id)) === JSON.stringify(shortlistBeforeRerank))
  let incompleteOrderRejected = false
  try { recruiting.reorderShortlist({ jobId: savedJob.id, resumes: [primaryRef] }) } catch { incompleteOrderRejected = true }
  check('rejects stale partial shortlist reorders without changing ranks', incompleteOrderRejected && recruiting.getShortlistExport(savedJob.id).results[0].resume.recordKey === versionRef.recordKey)
  recruiting.saveReview({ jobId: savedJob.id, resume: versionRef, status: 'not-proceeding', note: 'Conflicting review', order: 0, assessments: [] })
  let linkConflictRejected = false
  try { recruiting.linkVersions({ primary: primaryRef, version: versionRef }) } catch { linkConflictRejected = true }
  check('rejects conflicting version decisions without erasing either profile', linkConflictRejected && recruiting.listProfiles().length === 2)
  recruiting.saveReview({ jobId: savedJob.id, resume: versionRef, status: 'shortlisted', note: 'Arrange technical interview', order: 0, assessments: [] })
  recruiting.linkVersions({ primary: primaryRef, version: versionRef })
  recruiting.saveJob({ id: savedJob.id, posting, status: 'open', criteria: [{ id: 'python', text: 'Python leadership', importance: 'required' }] })
  const changedCriterion = recruiting.getJob(savedJob.id)
  check('invalidates confirmations when a criterion changes but preserves decisions', changedCriterion.job.stale && changedCriterion.reviews[0].assessments.length === 0 && changedCriterion.reviews[0].note === 'Arrange technical interview' && changedCriterion.reviews[0].status === 'shortlisted')
  await recruiting.searchJob(savedJob.id)
  const beforeHiring = recruiting.getJob(savedJob.id)
  const hiredWorkspace = recruiting.changeJobStatus({ jobId: savedJob.id, expectedUpdatedAt: beforeHiring.job.updatedAt, status: 'filled', placement: { hired: primaryRef } })
  check('status-only changes preserve matching scores and recruiter decisions', JSON.stringify(hiredWorkspace.response?.results) === JSON.stringify(beforeHiring.response?.results) && JSON.stringify(hiredWorkspace.reviews) === JSON.stringify(beforeHiring.reviews) && !hiredWorkspace.job.stale)
  closeDbForMaintenance()
  const persistedHiring = recruiting.getJob(savedJob.id).job
  check('hiring evidence and status timestamps survive a database restart', JSON.stringify(persistedHiring.statusHistory) === JSON.stringify(hiredWorkspace.job.statusHistory) && JSON.stringify(persistedHiring.placement) === JSON.stringify(hiredWorkspace.job.placement))

  const { smokeTalent, talentSnapshot } = await import('./smoke-talent.js')
  const talentFixture = smokeTalent(check, savedJob.id, primaryRef)
  const talent = await import('./recruiting/talent.js')
  const { smokeHiringBudgets, hiringBudgetsSnapshot } = await import('./smoke-hiring-budgets.js')
  const hiringBudgetsFixture = smokeHiringBudgets(check, clientCompany.id, savedJob.id, sourceCompany.id)

  console.log('\n7b. Portable backup and restore')
  const {
    commitRestore,
    exportPortableBackup,
    MAX_PORTABLE_BACKUP_BYTES,
    restorePortableBackup,
    rollbackRestore,
    validatePortableBackup
  } = await import('./db/backup.js')
  setSetting('theme', 'dark')
  setSetting('language', 'ar')
  setSetting('anthropicApiKey', 'must-not-leave-this-machine')
  setSetting('openaiApiKey', 'openai-must-not-leave-this-machine')
  const privateChatGptKeys = ['chatgpt:accounts:v1', 'chatgpt:host:v1', 'chatgpt:pending-client:v1', 'chatgpt:credentials:synthetic-account', 'rerankAuthMode:openai', 'rerankModel:chatgpt', 'rerankConsent:chatgpt:plan-model']
  for (const key of privateChatGptKeys) setSetting(key, 'synthetic-must-not-leave-this-machine')
  setSetting('rerankProvider', 'openai')
  setSetting('rerankModel:openai', 'gpt-6-astra')
  setSetting('rerankConsent:openai:gpt-6-astra', 'ai-rerank-v2')
  setSetting('watchedFolder', '/machine-specific/resumes')
  setSetting('windowState', '{"x":10,"y":20}')
  setSetting('rerankEnabled', 'true')

  const backupPath = join(scratch, 'library.qumaa-backup')
  const exported = await exportPortableBackup(backupPath)
  const validated = validatePortableBackup(backupPath)
  check('exports and validates every resume', exported.resumeCount === stats().resumeCount)
  check('reports matching backup metadata', JSON.stringify(exported) === JSON.stringify(validated))

  const oversizedBackupPath = join(scratch, 'oversized.qumaa-backup')
  copyFileSync(backupPath, oversizedBackupPath)
  truncateSync(oversizedBackupPath, MAX_PORTABLE_BACKUP_BYTES + 1)
  let oversizedBackupRejection = ''
  try {
    validatePortableBackup(oversizedBackupPath)
  } catch (error) {
    oversizedBackupRejection = String(error)
  }
  check(
    'rejects an oversized backup before SQLite opens it',
    oversizedBackupRejection.includes('1 GB safety limit')
  )

  const oversizedWalBackupPath = join(scratch, 'oversized-wal.qumaa-backup')
  copyFileSync(backupPath, oversizedWalBackupPath)
  copyFileSync(backupPath, `${oversizedWalBackupPath}-wal`)
  truncateSync(`${oversizedWalBackupPath}-wal`, MAX_PORTABLE_BACKUP_BYTES)
  let oversizedWalRejection = ''
  try {
    validatePortableBackup(oversizedWalBackupPath)
  } catch (error) {
    oversizedWalRejection = String(error)
  }
  check(
    'includes SQLite sidecars in the backup byte limit',
    oversizedWalRejection.includes('1 GB safety limit')
  )

  const backupDb = new Database(backupPath, { readonly: true, fileMustExist: true })
  const backupKeys = (
    backupDb.prepare('SELECT key FROM settings ORDER BY key').all() as Array<{ key: string }>
  ).map(({ key }) => key)
  const backedPaths = (
    backupDb.prepare("SELECT COUNT(*) AS count FROM resumes WHERE file_path <> ''").get() as {
      count: number
    }
  ).count
  const backedRecruitingKinds = (backupDb.prepare('SELECT kind FROM recruiting_records GROUP BY kind ORDER BY kind').all() as Array<{ kind: string }>).map((row) => row.kind)
  const backedCompany = JSON.parse((backupDb.prepare("SELECT data FROM recruiting_records WHERE kind = 'company' AND id = ?").get(clientCompany.id) as { data: string }).data)
  const backedLegacyCompany = (backupDb.prepare("SELECT data FROM recruiting_records WHERE kind = 'company' AND id = ?").get(sourceCompany.id) as { data: string }).data
  const backedJob = JSON.parse((backupDb.prepare("SELECT data FROM recruiting_records WHERE kind = 'job' AND id = ?").get(savedJob.id) as { data: string }).data)
  const backedHiringBudgets = JSON.stringify(backupDb.prepare("SELECT id,data FROM recruiting_records WHERE kind = 'hiringBudget' ORDER BY id").all())
  backupDb.close()
  check('backs up all cost-plan inputs, calculation versions and stable company/job links', backedHiringBudgets === hiringBudgetsFixture.snapshot)
  check('keeps only portable settings', backupKeys.join(',') === 'language,theme', backupKeys.join(','))
  check('removes source paths from the portable copy', backedPaths === 0, `${backedPaths} paths`)
  check('backs up recruiter work while excluding derived search snapshots', backedRecruitingKinds.join(',') === 'activity,assignment,company,hiringBudget,job,person,pool,profile,review,screening')
  check('backs up all company detail lists, job relationships, salary ranges, hiring budgets and research maps', backedCompany.id === editedCompany.id && backedCompany.note === editedCompany.note && companyDetailFields.every((field) => JSON.stringify(backedCompany[field]) === JSON.stringify(editedCompany[field])) && backedJob.id === savedJob.id && backedJob.companyId === clientCompany.id && JSON.stringify(backedJob.budget) === JSON.stringify(updatedBudget) && JSON.stringify(backedJob.hiringBudget) === JSON.stringify(totalHiringBudget) && JSON.stringify(backedJob.targetCompanies) === JSON.stringify(mappedTargets))
  check('portable backup preserves untouched legacy company JSON without rewriting its details', backedLegacyCompany === JSON.stringify(rawLegacySourceCompany))

  const malformedRecruitingPath = join(scratch, 'malformed-recruiting.qumaa-backup')
  copyFileSync(backupPath, malformedRecruitingPath)
  const malformedRecruiting = new Database(malformedRecruitingPath)
  malformedRecruiting.prepare("UPDATE recruiting_records SET data = ? WHERE kind = 'job'").run('{"forged":"field"}')
  malformedRecruiting.close()
  let malformedRecruitingRejected = false
  try { validatePortableBackup(malformedRecruitingPath) } catch { malformedRecruitingRejected = true }
  check('rejects malformed recruiter records before portable restore', malformedRecruitingRejected)

  const invalidDatePath = join(scratch, 'invalid-date.qumaa-backup')
  copyFileSync(backupPath, invalidDatePath)
  const invalidDateDatabase = new Database(invalidDatePath)
  const invalidDateJob = {
    ...backedJob,
    status: 'open', createdAt: 8_640_000_000_000_001, updatedAt: 8_640_000_000_000_001,
    lastSearchedAt: null, statusHistory: undefined, placement: undefined
  }
  invalidDateDatabase.prepare("UPDATE recruiting_records SET data = ? WHERE kind = 'job' AND id = ?")
    .run(JSON.stringify(invalidDateJob), savedJob.id)
  invalidDateDatabase.close()
  const invalidDateBytes = readFileSync(invalidDatePath)
  const currentJobBeforeInvalidDate = JSON.stringify(recruiting.getJob(savedJob.id).job)
  let invalidDateRejected = false
  try { await restorePortableBackup(invalidDatePath) } catch { invalidDateRejected = true }
  check(
    'rejects out-of-range restored dates before changing the current library or source backup',
    invalidDateRejected && readFileSync(invalidDatePath).equals(invalidDateBytes) &&
      JSON.stringify(recruiting.getJob(savedJob.id).job) === currentJobBeforeInvalidDate
  )
  const malformedCompanyCases = [
    { label: 'dangling hiring company', change: { companyId: unknownCompanyId }, error: 'unknown company' },
    { label: 'dangling target company', change: { targetCompanies: [{ ...mappedTargets[0], companyId: unknownCompanyId }] }, error: 'target company no longer exists' },
    { label: 'hiring company in its own target map', change: { targetCompanies: [{ ...mappedTargets[0], companyId: clientCompany.id }] }, error: 'hiring company cannot' },
    { label: 'reversed salary range', change: { budget: { ...updatedBudget, min: updatedBudget.max + 1 } }, error: 'minimum budget cannot' },
    { label: 'reversed total hiring budget', change: { hiringBudget: { ...totalHiringBudget, min: totalHiringBudget.max + 1 } }, error: 'minimum budget cannot' },
    { label: 'invalid total hiring currency', change: { hiringBudget: { ...totalHiringBudget, currency: 'sar' } }, error: 'hiringBudget.currency' }
  ]
  for (const [index, malformed] of malformedCompanyCases.entries()) {
    const path = join(scratch, `malformed-company-${index}.qumaa-backup`)
    copyFileSync(backupPath, path)
    const database = new Database(path)
    database.prepare("UPDATE recruiting_records SET data = ? WHERE kind = 'job' AND id = ?").run(JSON.stringify({ ...backedJob, ...malformed.change }), savedJob.id)
    database.close()
    let rejection = ''
    try { validatePortableBackup(path) } catch (error) { rejection = String(error) }
    check(`rejects ${malformed.label} before portable restore`, rejection.includes(malformed.error))
  }
  for (const [index, change] of [
    { companyId: unknownCompanyId }, { companyId: sourceCompany.id }, { jobId: unknownCompanyId },
    { calculationVersion: 'unsupported-rules' }, { inputs: { ...hiringBudgetsFixture.plan.inputs, headcount: 0 } }
  ].entries()) {
    const path = join(scratch, `invalid-hiring-budget-${index}.qumaa-backup`)
    copyFileSync(backupPath, path)
    const database = new Database(path)
    database.prepare("UPDATE recruiting_records SET data = ? WHERE kind = 'hiringBudget' AND id = ?").run(JSON.stringify({ ...hiringBudgetsFixture.plan, ...change }), hiringBudgetsFixture.plan.id)
    database.close()
    let rejected = false
    try { validatePortableBackup(path) } catch { rejected = true }
    check(`rejects invalid cost-plan references, engine version or inputs before restore (case ${index + 1})`, rejected)
  }
  for (const [kind, field] of [['activity', 'personId'], ['assignment', 'jobId'], ['screening', 'personId']] as const) {
    const path = join(scratch, `dangling-${kind}.qumaa-backup`)
    copyFileSync(backupPath, path)
    const database = new Database(path)
    const row = database.prepare('SELECT id,data FROM recruiting_records WHERE kind = ? LIMIT 1').get(kind) as { id: string; data: string }
    const invalid = { ...JSON.parse(row.data), [field]: unknownCompanyId }
    database.prepare('UPDATE recruiting_records SET data = ? WHERE kind = ? AND id = ?').run(JSON.stringify(invalid), kind, row.id)
    database.close()
    let rejected = false
    try { validatePortableBackup(path) } catch { rejected = true }
    check(`rejects dangling ${kind} references before restoring recruiter history`, rejected)
  }
  check(
    'leaves no plaintext API key bytes in the backup',
    !readFileSync(backupPath).includes(Buffer.from('must-not-leave-this-machine'))
  )

  const newerBackupPath = join(scratch, 'newer.qumaa-backup')
  copyFileSync(backupPath, newerBackupPath)
  const newerBackup = new Database(newerBackupPath)
  newerBackup.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`)
  newerBackup.close()
  let newerRejection = ''
  try {
    validatePortableBackup(newerBackupPath)
  } catch (error) {
    newerRejection = String(error)
  }
  check('rejects backups from newer schema versions', newerRejection.includes('newer Qumaa version'))

  const foreignBackupPath = join(scratch, 'foreign.qumaa-backup')
  copyFileSync(backupPath, foreignBackupPath)
  const foreignBackup = new Database(foreignBackupPath)
  foreignBackup.pragma('application_id = 1234')
  foreignBackup.close()
  let foreignRejection = ''
  try {
    validatePortableBackup(foreignBackupPath)
  } catch (error) {
    foreignRejection = String(error)
  }
  check('rejects files without Qumaa application identity', foreignRejection.includes('not a Qumaa backup'))

  const alteredBackupPath = join(scratch, 'altered.qumaa-backup')
  copyFileSync(backupPath, alteredBackupPath)
  const alteredBackup = new Database(alteredBackupPath)
  alteredBackup.exec('DROP TRIGGER resumes_au')
  alteredBackup.close()
  let schemaRejection = ''
  try {
    validatePortableBackup(alteredBackupPath)
  } catch (error) {
    schemaRejection = String(error)
  }
  check('rejects backups with an altered schema', schemaRejection.includes('does not match Qumaa schema'))

  const alteredTriggerPath = join(scratch, 'altered-trigger.qumaa-backup')
  copyFileSync(backupPath, alteredTriggerPath)
  const alteredTrigger = new Database(alteredTriggerPath)
  alteredTrigger.exec(`
    DROP TRIGGER resumes_au;
    CREATE TRIGGER resumes_au AFTER UPDATE ON resumes BEGIN SELECT 1; END;
  `)
  alteredTrigger.close()
  let triggerRejection = ''
  try {
    validatePortableBackup(alteredTriggerPath)
  } catch (error) {
    triggerRejection = String(error)
  }
  check(
    'rejects a same-name trigger with altered behaviour',
    triggerRejection.includes('resumes_au has altered SQL')
  )

  const oversizedSchemaPath = join(scratch, 'oversized-schema.qumaa-backup')
  copyFileSync(backupPath, oversizedSchemaPath)
  const oversizedSchema = new Database(oversizedSchemaPath)
  oversizedSchema.exec(
    `CREATE TABLE oversized_schema_fixture (value TEXT DEFAULT '${'x'.repeat(64 * 1024 * 4 + 1)}')`
  )
  oversizedSchema.close()
  let oversizedSchemaRejection = ''
  try {
    validatePortableBackup(oversizedSchemaPath)
  } catch (error) {
    oversizedSchemaRejection = String(error)
  }
  check(
    'bounds schema metadata before materialising object definitions',
    oversizedSchemaRejection.includes('schema metadata exceeds Qumaa safety limits')
  )

  const malformedSkillsPath = join(scratch, 'malformed-skills.qumaa-backup')
  copyFileSync(backupPath, malformedSkillsPath)
  const malformedSkills = new Database(malformedSkillsPath)
  malformedSkills.exec(
    "UPDATE resumes SET skills_json = '[\"python\"' WHERE id = (SELECT MIN(id) FROM resumes)"
  )
  malformedSkills.close()
  let skillsRejection = ''
  try {
    validatePortableBackup(malformedSkillsPath)
  } catch (error) {
    skillsRejection = String(error)
  }
  check('rejects malformed stored skills JSON', skillsRejection.includes('invalid skills JSON'))

  const nonStringSkillsPath = join(scratch, 'non-string-skills.qumaa-backup')
  copyFileSync(backupPath, nonStringSkillsPath)
  const nonStringSkills = new Database(nonStringSkillsPath)
  nonStringSkills.exec(
    "UPDATE resumes SET skills_json = '[\"python\", 3]' WHERE id = (SELECT MIN(id) FROM resumes)"
  )
  nonStringSkills.close()
  let nonStringSkillsRejection = ''
  try {
    validatePortableBackup(nonStringSkillsPath)
  } catch (error) {
    nonStringSkillsRejection = String(error)
  }
  check(
    'requires every stored skill id to be a string',
    nonStringSkillsRejection.includes('invalid skills JSON')
  )

  const malformedEmbeddingPath = join(scratch, 'malformed-embedding.qumaa-backup')
  copyFileSync(backupPath, malformedEmbeddingPath)
  const malformedEmbedding = new Database(malformedEmbeddingPath)
  malformedEmbedding.exec(
    "UPDATE chunks SET embedding = x'00010203' WHERE id = (SELECT MIN(id) FROM chunks)"
  )
  malformedEmbedding.close()
  let embeddingRejection = ''
  try {
    validatePortableBackup(malformedEmbeddingPath)
  } catch (error) {
    embeddingRejection = String(error)
  }
  check(
    'rejects malformed stored passage vectors',
    embeddingRejection.includes('invalid embedding vector')
  )

  const malformedDocumentVectorPath = join(scratch, 'malformed-document-vector.qumaa-backup')
  copyFileSync(backupPath, malformedDocumentVectorPath)
  const malformedDocumentVector = new Database(malformedDocumentVectorPath)
  malformedDocumentVector.exec(
    "UPDATE resumes SET doc_vector = x'00' WHERE id = (SELECT MIN(id) FROM resumes)"
  )
  malformedDocumentVector.close()
  let documentVectorRejection = ''
  try {
    validatePortableBackup(malformedDocumentVectorPath)
  } catch (error) {
    documentVectorRejection = String(error)
  }
  check(
    'rejects malformed stored document vectors',
    documentVectorRejection.includes('invalid document vector')
  )

  const malformedSectionPath = join(scratch, 'malformed-section.qumaa-backup')
  copyFileSync(backupPath, malformedSectionPath)
  const malformedSection = new Database(malformedSectionPath)
  malformedSection.exec(
    "UPDATE chunks SET section = 'references' WHERE id = (SELECT MIN(id) FROM chunks)"
  )
  malformedSection.close()
  let sectionRejection = ''
  try {
    validatePortableBackup(malformedSectionPath)
  } catch (error) {
    sectionRejection = String(error)
  }
  check('rejects unknown passage sections', sectionRejection.includes('invalid section'))

  const oversizedTextPath = join(scratch, 'oversized-text.qumaa-backup')
  copyFileSync(backupPath, oversizedTextPath)
  const oversizedText = new Database(oversizedTextPath)
  oversizedText
    .prepare('UPDATE resumes SET raw_text = ? WHERE id = (SELECT MIN(id) FROM resumes)')
    .run('x'.repeat(DATABASE_LIMITS.rawTextCharsPerResume * 4 + 1))
  oversizedText.close()
  let oversizedTextRejection = ''
  try {
    validatePortableBackup(oversizedTextPath)
  } catch (error) {
    oversizedTextRejection = String(error)
  }
  check(
    'rejects oversized stored resume text before materialising rows',
    oversizedTextRejection.includes('resume text exceeds the safety limit')
  )

  const nulTailBackupPath = join(scratch, 'nul-tail.qumaa-backup')
  copyFileSync(backupPath, nulTailBackupPath)
  const nulTailBackup = new Database(nulTailBackupPath)
  nulTailBackup
    .prepare('UPDATE resumes SET raw_text = ? WHERE id = (SELECT MIN(id) FROM resumes)')
    .run(nulTailText)
  nulTailBackup.close()
  const liveCountBeforeNulRestore = stats().resumeCount
  let nulTailBackupRejection = ''
  try {
    await restorePortableBackup(nulTailBackupPath)
  } catch (error) {
    nulTailBackupRejection = String(error)
  }
  check(
    'rejects a large NUL-tail backup before staging, FTS rebuild, or installation',
    nulTailBackupRejection.includes('embedded NUL character') &&
      stats().resumeCount === liveCountBeforeNulRestore
  )

  const tooManyChunksPath = join(scratch, 'too-many-chunks.qumaa-backup')
  copyFileSync(backupPath, tooManyChunksPath)
  const tooManyChunks = new Database(tooManyChunksPath)
  const chunkSeed = tooManyChunks
    .prepare(
      `SELECT resume_id AS resumeId, embedding,
              (SELECT COUNT(*) FROM chunks c2 WHERE c2.resume_id = chunks.resume_id) AS count
       FROM chunks
       ORDER BY resume_id
       LIMIT 1`
    )
    .get() as { resumeId: number; embedding: Buffer; count: number }
  const addChunk = tooManyChunks.prepare(
    "INSERT INTO chunks (resume_id, section, ordinal, text, embedding) VALUES (?, 'other', ?, 'bounded passage', ?)"
  )
  tooManyChunks.transaction(() => {
    for (let index = chunkSeed.count; index <= DATABASE_LIMITS.chunksPerResume; index++) {
      addChunk.run(chunkSeed.resumeId, index % DATABASE_LIMITS.chunksPerResume, chunkSeed.embedding)
    }
  })()
  tooManyChunks.close()
  let tooManyChunksRejection = ''
  try {
    validatePortableBackup(tooManyChunksPath)
  } catch (error) {
    tooManyChunksRejection = String(error)
  }
  check(
    'caps searchable passages per resume before vector iteration',
    tooManyChunksRejection.includes(
      `exceeds ${DATABASE_LIMITS.chunksPerResume} searchable passages`
    )
  )

  const tooManySettingsPath = join(scratch, 'too-many-settings.qumaa-backup')
  copyFileSync(backupPath, tooManySettingsPath)
  const tooManySettings = new Database(tooManySettingsPath)
  const addSetting = tooManySettings.prepare('INSERT INTO settings(key, value) VALUES (?, ?)')
  const existingSettings = (
    tooManySettings.prepare('SELECT COUNT(*) AS count FROM settings').get() as { count: number }
  ).count
  tooManySettings.transaction(() => {
    for (let index = existingSettings; index <= DATABASE_LIMITS.settings; index++) {
      addSetting.run(`bounded-fixture-${index}`, 'value')
    }
  })()
  tooManySettings.close()
  let tooManySettingsRejection = ''
  try {
    validatePortableBackup(tooManySettingsPath)
  } catch (error) {
    tooManySettingsRejection = String(error)
  }
  check(
    'caps stored settings before portability iteration',
    tooManySettingsRejection.includes(`exceeds ${DATABASE_LIMITS.settings} settings`)
  )

  const forgedDerivedPath = join(scratch, 'forged-derived.qumaa-backup')
  copyFileSync(backupPath, forgedDerivedPath)
  const forgedDerived = new Database(forgedDerivedPath)
  const forgedTarget = forgedDerived
    .prepare(
      "SELECT id, content_hash AS recordKey, raw_text AS rawText FROM resumes WHERE name = 'Maria Chen' LIMIT 1"
    )
    .get() as { id: number; recordKey: string; rawText: string }
  let forgedHash = 'f'.repeat(64)
  if (forgedDerived.prepare('SELECT 1 FROM resumes WHERE content_hash = ?').get(forgedHash)) {
    forgedHash = 'e'.repeat(64)
  }
  forgedDerived
    .prepare(
      `UPDATE resumes
       SET content_hash = ?, name = 'FORGED CANDIDATE', email = 'forged@example.test',
           phone = '+1 202 555 0199', location = 'Forged City', years_experience = 99,
           education_level = 'phd', skills_json = '["nursing"]', skills_version = ?,
           likely_scanned = 1, doc_vector = zeroblob(?)
       WHERE id = ?`
    )
    .run(forgedHash, SKILL_GAZETTEER_VERSION, v.byteLength, forgedTarget.id)
  forgedDerived
    .prepare(
      `UPDATE chunks
       SET section = 'summary',
           text = 'FORGED nursing patient care critical care medication administration',
           embedding = zeroblob(?)
       WHERE resume_id = ?`
    )
    .run(v.byteLength, forgedTarget.id)
  // Keep the intentionally forged fixture referentially valid, so this case
  // reaches derivative rebuilding rather than the earlier dangling-CV guard.
  for (const row of forgedDerived.prepare("SELECT id, data FROM recruiting_records WHERE kind = 'person'").all() as Array<{ id: string; data: string }>) {
    const person = JSON.parse(row.data)
    person.recordKeys = person.recordKeys.map((key: string) => key === forgedTarget.recordKey ? forgedHash : key)
    forgedDerived.prepare("UPDATE recruiting_records SET data = ? WHERE kind = 'person' AND id = ?").run(JSON.stringify(person), row.id)
  }
  forgedDerived.close()

  const expectedDerived = deriveResumeText(forgedTarget.rawText)
  const expectedVectors = await embedder.embedPassages(
    expectedDerived.chunks.map((chunk) => chunk.text)
  )
  const expectedDocumentVector = documentVector(expectedVectors)
  const rebuiltDerivedRestore = await restorePortableBackup(forgedDerivedPath)
  const rebuiltResume = getDb()
    .prepare(
      `SELECT content_hash AS contentHash, file_path AS filePath, raw_text AS rawText,
              name, email, phone, location, years_experience AS yearsExperience,
              education_level AS educationLevel, skills_json AS skillsJson,
              skills_version AS skillsVersion, likely_scanned AS likelyScanned,
              doc_vector AS documentVector
       FROM resumes WHERE id = ?`
    )
    .get(forgedTarget.id) as {
    contentHash: string
    filePath: string
    rawText: string
    name: string | null
    email: string | null
    phone: string | null
    location: string | null
    yearsExperience: number | null
    educationLevel: string | null
    skillsJson: string
    skillsVersion: string
    likelyScanned: number
    documentVector: Buffer
  }
  const rebuiltChunks = getDb()
    .prepare(
      'SELECT section, ordinal, text, embedding FROM chunks WHERE resume_id = ? ORDER BY ordinal'
    )
    .all(forgedTarget.id) as Array<{
    section: string
    ordinal: number
    text: string
    embedding: Buffer
  }>
  check(
    'recomputes normalized text and its content identity on restore',
    rebuiltResume.rawText === expectedDerived.normalized &&
      rebuiltResume.contentHash === expectedDerived.contentHash &&
      rebuiltResume.contentHash !== forgedHash
  )
  check(
    'recomputes parsed identity fields on restore',
    rebuiltResume.name === expectedDerived.fields.name &&
      rebuiltResume.email === expectedDerived.fields.email &&
      rebuiltResume.phone === expectedDerived.fields.phone &&
      rebuiltResume.location === expectedDerived.fields.location &&
      rebuiltResume.yearsExperience === expectedDerived.fields.yearsExperience &&
      rebuiltResume.educationLevel === expectedDerived.fields.educationLevel &&
      rebuiltResume.likelyScanned === 0 &&
      rebuiltResume.filePath === ''
  )
  check(
    'recomputes skills even when forged data claims the current gazetteer',
    rebuiltResume.skillsJson === JSON.stringify(expectedDerived.fields.skills) &&
      rebuiltResume.skillsVersion === SKILL_GAZETTEER_VERSION &&
      rebuiltResume.skillsJson !== '["nursing"]'
  )
  check(
    'rebuilds passage text, sections, and ordinals only from canonical text',
    JSON.stringify(rebuiltChunks.map(({ section, ordinal, text }) => ({ section, ordinal, text }))) ===
      JSON.stringify(expectedDerived.chunks)
  )
  check(
    're-embeds every rebuilt passage with the bundled model',
    rebuiltChunks.length === expectedVectors.length &&
      rebuiltChunks.every((chunk, index) => matchesVector(chunk.embedding, expectedVectors[index]))
  )
  check(
    'recomputes the document vector from rebuilt passages',
    matchesVector(rebuiltResume.documentVector, expectedDocumentVector)
  )
  check('commits model provenance only after restore rebuilding', isIndexCommitted())
  rollbackRestore(rebuiltDerivedRestore.rollbackPath)

  const duplicateCanonicalPath = join(scratch, 'duplicate-canonical.qumaa-backup')
  copyFileSync(backupPath, duplicateCanonicalPath)
  const duplicateCanonical = new Database(duplicateCanonicalPath)
  const duplicateRows = duplicateCanonical
    .prepare('SELECT id, raw_text AS rawText FROM resumes ORDER BY id LIMIT 2')
    .all() as Array<{ id: number; rawText: string }>
  duplicateCanonical
    .prepare('UPDATE resumes SET raw_text = ? WHERE id = ?')
    .run(duplicateRows[0].rawText, duplicateRows[1].id)
  duplicateCanonical.close()
  const beforeRejectedRestore = stats().resumeCount
  let duplicateRestoreRejection = ''
  try {
    await restorePortableBackup(duplicateCanonicalPath)
  } catch (error) {
    duplicateRestoreRejection = String(error)
  }
  check(
    'rejects duplicate canonical text during trusted rebuilding',
    duplicateRestoreRejection.includes('duplicate canonical resume text')
  )
  check(
    'rolls back the installed candidate when trusted rebuilding fails',
    stats().resumeCount === beforeRejectedRestore &&
      getSetting('anthropicApiKey') === 'must-not-leave-this-machine'
  )

  const staleFtsPath = join(scratch, 'stale-fts.qumaa-backup')
  copyFileSync(backupPath, staleFtsPath)
  const staleFts = new Database(staleFtsPath)
  const staleFtsResume = staleFts
    .prepare("SELECT id, raw_text AS rawText FROM resumes WHERE raw_text LIKE '%Kubernetes%' LIMIT 1")
    .get() as { id: number; rawText: string }
  staleFts
    .prepare(
      "INSERT INTO resumes_fts(resumes_fts, rowid, raw_text) VALUES ('delete', ?, ?)"
    )
    .run(staleFtsResume.id, staleFtsResume.rawText)
  // Scan MATCH postings before filtering in JavaScript. On this native FTS5
  // build, adding `AND rowid = ?` selects a direct-row plan that can still
  // return retained external-content text when that row's posting is missing.
  const staleMatches = staleFts
    .prepare("SELECT rowid AS id FROM resumes_fts WHERE resumes_fts MATCH 'kubernetes'")
    .all() as Array<{ id: number }>
  staleFts.close()
  check('constructs a backup with stale FTS postings', !staleMatches.some((row) => row.id === staleFtsResume.id))
  const repairedFtsRestore = await restorePortableBackup(staleFtsPath)
  const repairedMatches = getDb()
    .prepare("SELECT rowid AS id FROM resumes_fts WHERE resumes_fts MATCH 'kubernetes'")
    .all() as Array<{ id: number }>
  check('rebuilds staged FTS postings before restore', repairedMatches.some((row) => row.id === staleFtsResume.id))
  rollbackRestore(repairedFtsRestore.rollbackPath)

  const exportedCount = stats().resumeCount
  const removedBeforeRestore = getDb().prepare('SELECT id, content_hash AS recordKey FROM resumes ORDER BY id DESC LIMIT 1').get() as { id: number; recordKey: string }
  deleteResume(removedBeforeRestore)
  setSetting('theme', 'light')
  setSetting('language', 'en')
  const restored = await restorePortableBackup(backupPath)
  check('restores the exported library', stats().resumeCount === exportedCount)
  check('restores portable preferences', getSetting('theme') === 'dark')
  check('restores the interface language', getSetting('language') === 'ar')
  check('does not restore an API key', getSetting('anthropicApiKey') === null)
  check('does not restore ChatGPT credentials, registrations, host identity or sharing settings', privateChatGptKeys.every((key) => getSetting(key) === null))
  check('does not restore OpenAI credentials or provider sharing settings', getSetting('openaiApiKey') === null && getSetting('rerankProvider') === null && getSetting('rerankModel:openai') === null && getSetting('rerankConsent:openai:gpt-6-astra') === null)
  check('does not restore a watched folder', getSetting('watchedFolder') === null)
  check('does not restore machine window state', getSetting('windowState') === null)
  check('does not enable cloud reranking without a key', getSetting('rerankEnabled') === null)
  const restoredWorkspace = recruiting.getJob(savedJob.id)
  check('restores all recruiter desk records exactly with their references and dates', talentSnapshot() === talentFixture.snapshot)
  check('restores every hiring cost plan and its original inputs, versions, dates and company/job links', hiringBudgetsSnapshot() === hiringBudgetsFixture.snapshot)
  check('restores jobs, notes, profile corrections and explicit CV history', restoredWorkspace.reviews[0].note === 'Arrange technical interview' && restoredWorkspace.profiles[0].recordKeys.length === 2 && restoredWorkspace.profiles[0].expectedSalary === 'SAR 22000')
  const restoredCompany = recruiting.listCompanies().find((company) => company.id === clientCompany.id)!
  const restoredLegacyCompany = recruiting.listCompanies().find((company) => company.id === sourceCompany.id)!
  check('restores all company detail lists, salary ranges, total hiring budgets and target research', recruiting.listCompanies().length === 2 && restoredCompany.id === editedCompany.id && restoredCompany.createdAt === editedCompany.createdAt && restoredCompany.note === editedCompany.note && companyDetailFields.every((field) => JSON.stringify(restoredCompany[field]) === JSON.stringify(editedCompany[field])) && restoredWorkspace.job.id === savedJob.id && restoredWorkspace.job.companyId === clientCompany.id && JSON.stringify(restoredWorkspace.job.budget) === JSON.stringify(updatedBudget) && JSON.stringify(restoredWorkspace.job.hiringBudget) === JSON.stringify(totalHiringBudget) && JSON.stringify(restoredWorkspace.job.targetCompanies) === JSON.stringify(mappedTargets))
  check('restores legacy company details as whole-value lists with original identity and dates', restoredLegacyCompany.id === sourceCompany.id && restoredLegacyCompany.createdAt === sourceCompany.createdAt && restoredLegacyCompany.updatedAt === sourceCompany.updatedAt && restoredLegacyCompany.industry.length === 1 && restoredLegacyCompany.industry[0] === rawLegacySourceCompany.industry && restoredLegacyCompany.location[0] === rawLegacySourceCompany.location && restoredLegacyCompany.contactName.length === 0 && restoredLegacyCompany.contactEmail.length === 0)
  check('portable restore preserves hiring selections and recorded status dates', JSON.stringify(restoredWorkspace.job.statusHistory) === JSON.stringify(persistedHiring.statusHistory) && JSON.stringify(restoredWorkspace.job.placement) === JSON.stringify(persistedHiring.placement))
  check('requires fresh local matching after restore instead of trusting backup rankings', restoredWorkspace.response === null && restoredWorkspace.job.stale)
  check('retains the exact pre-restore database for rollback', statSync(restored.rollbackPath).size > 0)

  rollbackRestore(restored.rollbackPath)
  check('rollback restores the exact previous library', stats().resumeCount === exportedCount - 1)
  check('rollback preserves the previous local-only settings', getSetting('anthropicApiKey') !== null)
  check('rollback consumes its private recovery file', !existsSync(restored.rollbackPath))

  await recruiting.searchTemporary({ posting, status: 'open', criteria: [] })
  const committed = await restorePortableBackup(backupPath)
  check('a second restore returns to the sanitised portable state', getSetting('anthropicApiKey') === null)
  commitRestore(committed.rollbackPath)
  check('committing a restored library clears temporary search state', temporarySearch.id === null)
  check('committing a healthy restore removes its rollback file', !existsSync(committed.rollbackPath))

  const beforePrivateDeletion = await recruiting.searchJob(savedJob.id)
  recruiting.saveJobRerank({ jobId: savedJob.id, sessionId: beforePrivateDeletion.response!.sessionId }, beforePrivateDeletion.response!.results.map((result) => ({ ...result, llmReason: 'Private explanation for the deletion fixture.' })))
  check('deleting one CV preserves the person’s other version', deleteResume(primaryRef) && recruiting.listProfiles()[0].recordKeys.join(',') === versionRef.recordKey && recruiting.getJob(savedJob.id).reviews[0].note === 'Arrange technical interview')
  const scrubbedHiring = recruiting.getJob(savedJob.id).job
  check('CV deletion scrubs private hiring identities while preserving status dates', scrubbedHiring.placement?.hired.recordKey === null && scrubbedHiring.placement.hired.name === null && scrubbedHiring.statusHistory?.at(-1)?.placement?.hired.recordKey === null && scrubbedHiring.statusHistory.at(-1)?.placement?.hired.name === null && scrubbedHiring.statusHistory.at(-1)?.at === persistedHiring.statusHistory?.at(-1)?.at)
  check('bulk-deleting the last CV removes its private profile and every job review', deleteResumes([versionRef]) === 1 && recruiting.listProfiles().length === 0 && recruiting.getJob(savedJob.id).reviews.length === 0 && recruiting.getJob(otherJob.id).reviews.length === 0)
  check('deleting the final CV removes its library contact, pipeline and screenings', !talent.overview().people.some((person) => person.id === talentFixture.libraryPersonId) && !talent.overview().assignments.some((row) => row.personId === talentFixture.libraryPersonId) && !talent.overview().screenings.some((row) => row.personId === talentFixture.libraryPersonId))
  check('CV deletion preserves manually created prospects and their contact histories', talent.overview().people.some((person) => person.id === talentFixture.prospectId) && talent.overview().activities.filter((row) => row.personId === talentFixture.prospectId).length === 2)
  check('CV deletion preserves independent company cost plans', hiringBudgetsSnapshot() === hiringBudgetsFixture.snapshot)
  check('CV deletion preserves independent companies, job budgets and target research', recruiting.listCompanies().length === 2 && recruiting.getJob(savedJob.id).job.companyId === clientCompany.id && JSON.stringify(recruiting.getJob(savedJob.id).job.targetCompanies) === JSON.stringify(mappedTargets))
  check('deleting a reranked CV removes its stored Claude explanation', !(getDb().prepare("SELECT data FROM recruiting_records WHERE kind = 'snapshot' AND id = ?").get(savedJob.id) as { data: string }).data.includes('Private explanation for the deletion fixture.'))

  console.log(`\n8. Final state: ${stats().resumeCount} resumes, ${stats().chunkCount} chunks`)

  // 9. The wipe is irreversible and sits behind a button in Settings, so it is
  // checked here rather than trusted: everything gone, FTS not left orphaned,
  // and a usable database afterwards.
  console.log('\n9. Delete all data')
  setSetting('theme', 'dark')
  const wipeMarker = 'QUMAA_WIPE_REMANENCE_CONTROL_7F4D2B91'
  getDb()
    .prepare(
      `INSERT INTO resumes
         (file_path, file_name, content_hash, file_type, imported_at, raw_text,
          skills_json, skills_version)
       VALUES ('', 'wipe-control.md', ?, 'md', ?, ?, '[]', ?)`
    )
    .run('f'.repeat(64), Date.now(), wipeMarker, SKILL_GAZETTEER_VERSION)
  getDb().pragma('wal_checkpoint(TRUNCATE)')
  check(
    'establishes a wipe-remanence positive control',
    readFileSync(dbPath()).includes(wipeMarker)
  )
  deleteAllData()
  check('removes every resume', stats().resumeCount === 0, `${stats().resumeCount} left`)
  check('removes every chunk', stats().chunkCount === 0, `${stats().chunkCount} left`)
  check('removes stored settings', getSetting('theme') === null, String(getSetting('theme')))
  check('removes the interface language preference', getSetting('language') === null)
  check('removes saved jobs and recruiter records', recruiting.listJobs().length === 0 && recruiting.listProfiles().length === 0)
  check('removes every company and its private contact notes', recruiting.listCompanies().length === 0)
  check('full library wipe removes all hiring cost plans and private assumptions', hiringBudgetsSnapshot() === '[]')
  check('removes all prospects, reminders, submissions, screenings and pools', Object.values(talent.overview()).every((records) => records.length === 0))
  const databaseArtifacts = [dbPath(), `${dbPath()}-wal`, `${dbPath()}-shm`]
    .filter(existsSync)
    .map((path) => readFileSync(path))
  check(
    'removes resume text from the live database and WAL artifacts',
    databaseArtifacts.every((artifact) => !artifact.includes(wipeMarker))
  )

  const orphaned = getDb()
    .prepare("SELECT COUNT(*) c FROM resumes_fts WHERE resumes_fts MATCH 'engineer'")
    .get() as { c: number }
  check('leaves no orphaned FTS rows', orphaned.c === 0, `${orphaned.c} stale rows`)

  check('restores provenance before post-wipe ingestion', markEmptyIndexCurrent())
  check('post-wipe index marker is current', isIndexCommitted())

  const after = await ingestText({
    text: 'Dana Reyes\ndana@example.com\n\nWORK EXPERIENCE\nAcme - Operations Lead\n2019 - 2024\nRan onboarding and wrote standard operating procedures.\n\nSKILLS\nTraining, SOPs, onboarding',
    fileName: 'after-wipe.md',
    filePath: '',
    fileType: 'pasted'
  })
  check('database still usable afterwards', after.status === 'imported', after.status)

  console.log('\n10. Live library capacity admission')
  const fillLibrary = getDb().transaction(() => {
    const insert = getDb().prepare(
      `INSERT INTO resumes
         (file_path, file_name, content_hash, file_type, imported_at, raw_text,
          skills_json, skills_version)
       VALUES ('', ?, ?, 'pasted', ?, ?, '[]', ?)`
    )
    for (let index = 1; index < DATABASE_LIMITS.resumes; index++) {
      insert.run(
        `capacity-${index}.md`,
        index.toString(16).padStart(64, '0'),
        1_700_000_000_000 + index,
        `Capacity fixture ${index}`,
        SKILL_GAZETTEER_VERSION
      )
    }
  })
  fillLibrary()
  // Reset the in-process aggregate cache and prove the full database remains a
  // valid startup input exactly at the supported ceiling.
  closeDbForMaintenance()
  getDb()
  const beyondCapacity = await ingestText({
    text: 'Unique candidate beyond capacity with enough searchable resume words to be indexed safely.',
    fileName: 'over-capacity.md',
    filePath: '',
    fileType: 'pasted'
  })
  check(
    'rejects a normal import before it can exceed startup invariants',
    beyondCapacity.status === 'failed' && beyondCapacity.reason.includes('5000-resume')
  )
  check('keeps the live library at its valid ceiling', stats().resumeCount === DATABASE_LIMITS.resumes)
  // Reuse real stored passages for a bounded 65-candidate fixture. This checks
  // promotion beyond the 50-result consent cache without re-embedding 5,000 CVs.
  const templateResume = after.status === 'imported' ? after.resume.id : 0
  const extraResumeIds = getDb().prepare("SELECT id FROM resumes WHERE file_name LIKE 'capacity-%' ORDER BY id LIMIT 64").all() as Array<{ id: number }>
  const copyPassages = getDb().prepare('INSERT INTO chunks(resume_id, section, ordinal, text, embedding) SELECT ?, section, ordinal, text, embedding FROM chunks WHERE resume_id = ?')
  getDb().transaction(() => { for (const row of extraResumeIds) copyPassages.run(row.id, templateResume) })()
  for (let index = 0; index < 250; index++) recruiting.saveJob({ posting: { ...posting, position: `Saved capacity job ${index}` }, status: 'open', criteria: [] })
  const fullTemporary = await recruiting.searchTemporary({ posting, status: 'open', criteria: [] })
  check('temporary matching works at the saved-job limit and retains all candidates', fullTemporary.response!.results.length === 65 && searchSessions.get(fullTemporary.response!.sessionId).response.results.length === 50)
  let promotionAtCapacityRejected = false
  try { recruiting.saveTemporary({ jobId: fullTemporary.job.id, sessionId: fullTemporary.response!.sessionId }) } catch { promotionAtCapacityRejected = true }
  check('failed promotion preserves temporary results and writes no partial job', promotionAtCapacityRejected && recruiting.listJobs().length === 250 && temporarySearch.id === fullTemporary.job.id)
  getDb().prepare("DELETE FROM recruiting_records WHERE kind = 'job' AND id = ?").run(recruiting.listJobs()[0].id)
  const promotedFullTemporary = recruiting.saveTemporary({ jobId: fullTemporary.job.id, sessionId: fullTemporary.response!.sessionId })
  check('promotion stores all results beyond the bounded consent cache', promotedFullTemporary.response!.results.length === 65 && JSON.stringify(promotedFullTemporary.response!.results) === JSON.stringify(fullTemporary.response!.results))
  await recruiting.searchTemporary({ posting, status: 'open', criteria: [] })
  deleteAllData()
  check('full deletion also clears temporary postings and results', temporarySearch.id === null)
  const { smokeDerived } = await import('./smoke-derived.js')
  await smokeDerived(check)
  const { smokeRequirements } = await import('./smoke-requirements.js')
  await smokeRequirements(check)
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
