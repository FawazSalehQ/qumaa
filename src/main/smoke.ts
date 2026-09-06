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
  const savedJob = recruiting.saveJob({ posting, status: 'open', criteria: [{ id: 'python', text: 'Python services', importance: 'required' }] })
  const otherJob = recruiting.saveJob({ posting: { ...posting, position: 'Future vacancy' }, status: 'on-hold', criteria: [] })
  check('persists multiple independent job drafts', recruiting.listJobs().length === 2 && recruiting.getJob(savedJob.id).response === null)
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
  const suggested = recruiting.getEvidence({ jobId: savedJob.id, resumes: [{ id: selectedResume.id, recordKey: selectedResume.recordKey }] })[selectedResume.recordKey][0].passage
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
  closeDbForMaintenance()
  const reopenedWorkspace = recruiting.getJob(savedJob.id)
  check('reopens saved results and recruiter work after a database restart', reopenedWorkspace.response !== null && reopenedWorkspace.reviews[0].note === 'Arrange technical interview' && reopenedWorkspace.profiles[0].expectedSalary === 'SAR 22000' && !reopenedWorkspace.job.stale)
  check('reconstructs trusted search sessions from canonical stored CV rows', searchSessions.get(reopenedWorkspace.response!.sessionId).response.results.find((result) => result.resume.recordKey === selectedResume.recordKey)?.resume.name === selectedResume.name)

  const versionOutcome = await ingestText({ text: `${detail!.rawText}\n\nPROJECTS\n2026: Led a Python platform migration and Kubernetes training for thirty engineers.`, fileName: 'maria-updated.md', filePath: '', fileType: 'pasted' })
  if (versionOutcome.status !== 'imported' && versionOutcome.status !== 'near-duplicate') throw new Error('Could not create the CV-version smoke fixture.')
  const newerResume = versionOutcome.resume
  check('discovers new arrivals for previously searched jobs', recruiting.listJobs().find((job) => job.id === savedJob.id)?.newResumeCount === 1 && recruiting.getJob(savedJob.id).job.stale)
  let staleExportRejected = false
  try { recruiting.getShortlistExport(savedJob.id) } catch { staleExportRejected = true }
  check('requires refreshed rankings before exporting changed libraries', staleExportRejected)
  const primaryRef = { id: selectedResume.id, recordKey: selectedResume.recordKey }
  const versionRef = { id: newerResume.id, recordKey: newerResume.recordKey }
  recruiting.linkVersions({ primary: primaryRef, version: versionRef })
  const linkedWorkspace = await recruiting.searchJob(savedJob.id)
  check('deduplicates versions using the latest CV while preserving reviews', linkedWorkspace.response?.results.some((result) => result.resume.recordKey === newerResume.recordKey) === true && !linkedWorkspace.response.results.some((result) => result.resume.recordKey === selectedResume.recordKey) && linkedWorkspace.job.shortlistCount === 1)
  const linkedExport = recruiting.getShortlistExport(savedJob.id)
  check('exports the selected candidate with profile corrections and job notes', linkedExport.results.length === 1 && linkedExport.results[0].resume.recordKey === newerResume.recordKey && linkedExport.results[0].resume.name === 'Maria Chen (confirmed)' && linkedExport.notes[newerResume.recordKey] === 'Arrange technical interview')
  recruiting.unlinkVersion({ resume: versionRef })
  check('unlinking retains recruiter history for both resulting profiles', recruiting.getJob(savedJob.id).job.shortlistCount === 2 && recruiting.listProfiles().filter((profile) => profile.note === 'Recruiter profile note').length === 2)
  recruiting.reorderShortlist({ jobId: savedJob.id, resumes: [versionRef, primaryRef] })
  check('atomically orders selected export candidates', recruiting.getShortlistExport(savedJob.id).results.map((result) => result.resume.recordKey).join(',') === [versionRef.recordKey, primaryRef.recordKey].join(','))
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
  setSetting('anthropicApiKey', 'must-not-leave-this-machine')
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
  backupDb.close()
  check('keeps only portable settings', backupKeys.join(',') === 'theme', backupKeys.join(','))
  check('removes source paths from the portable copy', backedPaths === 0, `${backedPaths} paths`)
  check('backs up recruiter work while excluding derived search snapshots', backedRecruitingKinds.join(',') === 'job,profile,review')

  const malformedRecruitingPath = join(scratch, 'malformed-recruiting.qumaa-backup')
  copyFileSync(backupPath, malformedRecruitingPath)
  const malformedRecruiting = new Database(malformedRecruitingPath)
  malformedRecruiting.prepare("UPDATE recruiting_records SET data = ? WHERE kind = 'job'").run('{"forged":"field"}')
  malformedRecruiting.close()
  let malformedRecruitingRejected = false
  try { validatePortableBackup(malformedRecruitingPath) } catch { malformedRecruitingRejected = true }
  check('rejects malformed recruiter records before portable restore', malformedRecruitingRejected)
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
      "SELECT id, raw_text AS rawText FROM resumes WHERE name = 'Maria Chen' LIMIT 1"
    )
    .get() as { id: number; rawText: string }
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
  getDb().prepare('DELETE FROM resumes WHERE id = (SELECT MAX(id) FROM resumes)').run()
  setSetting('theme', 'light')
  const restored = await restorePortableBackup(backupPath)
  check('restores the exported library', stats().resumeCount === exportedCount)
  check('restores portable preferences', getSetting('theme') === 'dark')
  check('does not restore an API key', getSetting('anthropicApiKey') === null)
  check('does not restore a watched folder', getSetting('watchedFolder') === null)
  check('does not restore machine window state', getSetting('windowState') === null)
  check('does not enable cloud reranking without a key', getSetting('rerankEnabled') === null)
  const restoredWorkspace = recruiting.getJob(savedJob.id)
  check('restores jobs, notes, profile corrections and explicit CV history', restoredWorkspace.reviews[0].note === 'Arrange technical interview' && restoredWorkspace.profiles[0].recordKeys.length === 2 && restoredWorkspace.profiles[0].expectedSalary === 'SAR 22000')
  check('requires fresh local matching after restore instead of trusting backup rankings', restoredWorkspace.response === null && restoredWorkspace.job.stale)
  check('retains the exact pre-restore database for rollback', statSync(restored.rollbackPath).size > 0)

  rollbackRestore(restored.rollbackPath)
  check('rollback restores the exact previous library', stats().resumeCount === exportedCount - 1)
  check('rollback preserves the previous local-only settings', getSetting('anthropicApiKey') !== null)
  check('rollback consumes its private recovery file', !existsSync(restored.rollbackPath))

  const committed = await restorePortableBackup(backupPath)
  check('a second restore returns to the sanitised portable state', getSetting('anthropicApiKey') === null)
  commitRestore(committed.rollbackPath)
  check('committing a healthy restore removes its rollback file', !existsSync(committed.rollbackPath))

  check('deleting one CV preserves the person’s other version', deleteResume(primaryRef) && recruiting.listProfiles()[0].recordKeys.join(',') === versionRef.recordKey && recruiting.getJob(savedJob.id).reviews[0].note === 'Arrange technical interview')
  check('bulk-deleting the last CV removes its private profile and every job review', deleteResumes([versionRef]) === 1 && recruiting.listProfiles().length === 0 && recruiting.getJob(savedJob.id).reviews.length === 0 && recruiting.getJob(otherJob.id).reviews.length === 0)

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
  check('removes saved jobs and recruiter records', recruiting.listJobs().length === 0 && recruiting.listProfiles().length === 0)
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
  deleteAllData()
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
