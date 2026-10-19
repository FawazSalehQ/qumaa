/** Parser upgrade and Arabic FTS integration; run only inside disposable Electron smoke. */
import { closeDbForMaintenance, deleteAllData, getDb, getSetting, listResumes, setSetting } from './db/index.js'
import { embedder } from './embed/client.js'
import { isIndexCommitted } from './embed/reindex.js'
import { backfillResumeDerivedData, isResumeDerivationCurrent } from './ingest/derived-backfill.js'
import { RESUME_DERIVATION_KEY } from './ingest/derivation-version.js'
import { deriveStoredResumeText } from './ingest/derive.js'
import { ingestText } from './ingest/pipeline.js'
import * as recruiting from './recruiting/index.js'
import * as talent from './recruiting/talent.js'
import { buildFtsQuery } from './search/scoring.js'
import { searchSessions } from './search/sessions.js'
import { temporarySearch } from './recruiting/temporary.js'
import { diagnoseSearch } from './eval-diagnostics.js'
import { search } from './search/rank.js'
import { normalizeScores } from './search/scoring.js'

type Check = (label: string, ok: boolean, detail?: string) => void

export async function smokeDerived(check: Check): Promise<void> {
  const previousParser = '2:arabic-sections-and-locations'
  console.log('\n11. Parser upgrades and Arabic lexical retrieval')
  await backfillResumeDerivedData()
  check('establishes parser and model provenance on an empty library', isResumeDerivationCurrent() && isIndexCommitted())
  const texts = [
    'ليان منصور\n\n## الملخص المهني\nمهندسة تعمل على تخطيط الآبار وتصميم برامج الحفر ومراجعة البيانات التشغيلية وإعداد التقارير الفنية مع فريق العمل.\n\n## الخبرة المهنية\nمهندسة حفر\nJan 2019 - Dec 2023\nأعدت برامج تصميم التغليف وراجعت سوائل الحفر وحسابات الهيدروليكا وتحليل الأداء والتكاليف اليومية لعمليات النفط والغاز.',
    'Mira Dawson\nRiyadh, Saudi Arabia\n\n## Work Experience\nEngineer\nJan 2018 - Dec 2023\nDesigned well casing programs and reviewed drilling fluids and hydraulics with multidisciplinary engineering teams for offshore operations.',
    // Bulleted bare numbers survive one normalisation only; the rebuild must derive stored text as it is.
    'Omar Haddad\nDammam, Saudi Arabia\n\n## Awards\n• 2019\n• 2021\n\n## Work Experience\nDrilling supervisor\nJan 2016 - Dec 2023\nSupervised rig crews, managed well control drills and coordinated casing and cementing operations for onshore wells.'
  ]
  for (const [index, text] of texts.entries()) {
    const outcome = await ingestText({ text, fileName: `upgrade-${index}.md`, filePath: `/fictional-originals/upgrade-${index}.md`, fileType: 'md' })
    if (outcome.status !== 'imported' && outcome.status !== 'near-duplicate') throw new Error('Could not create parser upgrade fixture')
  }
  const [resume] = listResumes().sort((a, b) => a.id - b.id)
  const ref = { id: resume.id, recordKey: resume.recordKey }
  const company = recruiting.saveCompany({ name: 'Parser Upgrade Client', industry: '', location: '', website: '', contactName: '', contactEmail: '', note: 'Keep hiring context' })
  const posting = { position: 'Well engineer', jobDescription: 'Plan well construction and drilling fluids programs', requirements: '', educationAndCertifications: '' }
  const job = recruiting.saveJob({ posting, status: 'open', criteria: [], companyId: company.id, budget: { min: 15000, max: 22000, currency: 'SAR', period: 'monthly' } })
  const oldWorkspace = await recruiting.searchJob(job.id)
  recruiting.saveReview({ jobId: job.id, resume: ref, status: 'shortlisted', note: 'Keep recruiter decision', order: 0, assessments: [] })
  recruiting.saveProfile({ resume: ref, name: 'Recruiter correction', email: null, phone: null, location: 'Recruiter location', yearsExperience: null, educationLevel: null, skills: null, expectedSalary: 'SAR 20000', noticePeriod: '', availability: '', preferredLocation: '', tags: [], note: 'Keep profile notes' })
  const person = talent.ensurePerson(ref)
  talent.saveAssignment({ personId: person.id, jobId: job.id, stage: 'screened', nextAction: 'Call back', dueAt: null, note: 'Keep pipeline notes', clientFeedback: '' })
  talent.generateScreening({ personId: person.id, jobId: job.id })
  await recruiting.searchTemporary({ posting, status: 'open', criteria: [] })
  const originals = JSON.stringify(getDb().prepare('SELECT id, content_hash, raw_text, file_path, file_name, file_type, imported_at FROM resumes ORDER BY id').all())
  const manual = (): string => JSON.stringify(getDb().prepare("SELECT kind,id,data FROM recruiting_records WHERE kind != 'snapshot' ORDER BY kind,id").all())
  const savedManual = manual()
  getDb().prepare("UPDATE chunks SET section = 'other'").run()
  getDb().prepare("UPDATE resumes SET location = 'الخبر', years_experience = 99").run()
  setSetting(RESUME_DERIVATION_KEY, previousParser)

  const oldIndex = JSON.stringify(getDb().prepare('SELECT * FROM chunks ORDER BY id').all())
  const oldSnapshots = JSON.stringify(getDb().prepare("SELECT * FROM recruiting_records WHERE kind = 'snapshot' ORDER BY id").all())
  const oldModel = getSetting('embeddingModel')
  const oldText = (getDb().prepare('SELECT raw_text AS text FROM resumes WHERE id = ?').get(resume.id) as { text: string }).text
  getDb().prepare('UPDATE resumes SET raw_text = ? WHERE id = ?').run(`${oldText}\nUnexpected identity mismatch`, resume.id)
  let preflightRejected = false
  try { await backfillResumeDerivedData() } catch { preflightRejected = true }
  getDb().prepare('UPDATE resumes SET raw_text = ? WHERE id = ?').run(oldText, resume.id)
  check('failed parser preflight retains the complete old index and saved evidence', preflightRejected &&
    oldIndex === JSON.stringify(getDb().prepare('SELECT * FROM chunks ORDER BY id').all()) &&
    oldSnapshots === JSON.stringify(getDb().prepare("SELECT * FROM recruiting_records WHERE kind = 'snapshot' ORDER BY id").all()) &&
    oldModel === getSetting('embeddingModel') && getSetting(RESUME_DERIVATION_KEY) === previousParser)

  const originalEmbed = embedder.embedPassages
  let calls = 0
  embedder.embedPassages = async (input) => {
    if (++calls === 2) throw new Error('Simulated embedding interruption')
    return originalEmbed.call(embedder, input)
  }
  let failed = false
  try { await backfillResumeDerivedData() } catch (error) { failed = String(error).includes('Simulated embedding interruption') }
  finally { embedder.embedPassages = originalEmbed }
  check('an interrupted parser rebuild never publishes a complete index', failed && !isResumeDerivationCurrent() && !isIndexCommitted())
  check('rechunking removes obsolete saved evidence and temporary sessions', !getDb().prepare("SELECT 1 FROM recruiting_records WHERE kind = 'snapshot'").get() && temporarySearch.id === null)
  let oldSessionRejected = false
  try { searchSessions.get(oldWorkspace.response!.sessionId) } catch { oldSessionRejected = true }
  check('rechunking invalidates live preview sessions before changing passages', oldSessionRejected)
  check('interruption retains canonical CVs and every recruiter record', originals === JSON.stringify(getDb().prepare('SELECT id, content_hash, raw_text, file_path, file_name, file_type, imported_at FROM resumes ORDER BY id').all()) && manual() === savedManual)

  // Reopen the actual partially rebuilt database, including schema/reference validation.
  closeDbForMaintenance()
  getDb()
  check('an interrupted rebuild remains readable and visibly pending after restart', !isResumeDerivationCurrent() && getSetting(RESUME_DERIVATION_KEY)?.startsWith('updating:') === true)
  const rebuilt = await backfillResumeDerivedData()
  check('retry rebuilds the entire library and commits both provenance markers', rebuilt === texts.length && isResumeDerivationCurrent() && isIndexCommitted())
  const actualChunks = getDb().prepare('SELECT section, ordinal, text FROM chunks WHERE resume_id = ? ORDER BY ordinal')
  const records = getDb().prepare('SELECT id,raw_text AS text,location,years_experience AS yearsExperience FROM resumes ORDER BY id').all() as Array<{ id: number; text: string; location: string | null; yearsExperience: number | null }>
  check('upgraded chunks and fields equal fresh canonical extraction', records.every((record) => {
    const fresh = deriveStoredResumeText(record.text)
    return JSON.stringify(actualChunks.all(record.id)) === JSON.stringify(fresh.chunks) && record.location === fresh.fields.location && record.yearsExperience === fresh.fields.yearsExperience
  }))
  check('Arabic experience headings no longer invent a Khobar address', records[0].location === null)
  check('parser upgrades preserve stable identities, original paths, notes and pipeline history', originals === JSON.stringify(getDb().prepare('SELECT id, content_hash, raw_text, file_path, file_name, file_type, imported_at FROM resumes ORDER BY id').all()) && manual() === savedManual)
  const workspace = recruiting.getJob(job.id)
  check('saved jobs request rematching while retaining shortlist decisions', workspace.job.stale && workspace.response === null && workspace.reviews[0].note === 'Keep recruiter decision')
  const beforeNoop = JSON.stringify(getDb().prepare('SELECT * FROM chunks ORDER BY id').all())
  check('a current parser skips repeat migration', await backfillResumeDerivedData() === 0 && beforeNoop === JSON.stringify(getDb().prepare('SELECT * FROM chunks ORDER BY id').all()))

  const query = buildFtsQuery('مطلوب مهندس حفر في النفط والغاز')
  const matches = getDb().prepare('SELECT rowid AS id FROM resumes_fts WHERE resumes_fts MATCH ?').all(query) as Array<{ id: number }>
  check('Arabic query terms retrieve actual Arabic resume text through SQLite FTS', matches.some((row) => row.id === resume.id))
  const filenameOnly = buildFtsQuery('upgrade')
  check('lexical retrieval continues to exclude filenames', getDb().prepare('SELECT rowid FROM resumes_fts WHERE resumes_fts MATCH ?').all(filenameOnly).length === 0)

  const embedQueries = embedder.embedQueries
  let queryCalls = 0
  let diagnostics: ReturnType<typeof diagnoseSearch> | undefined
  embedder.embedQueries = async (input) => { queryCalls++; return embedQueries.call(embedder, input) }
  try {
    const response = await search('مهندس حفر في النفط والغاز\nتخطيط الآبار ومراجعة سوائل الحفر', 10,
      (inspection) => { diagnostics = diagnoseSearch(inspection) })
    const rows = diagnostics!.candidates
    const semantic = normalizeScores(rows.map((row) => row.semantic))
    const lexical = normalizeScores(rows.map((row) => row.lexical))
    check('evaluation diagnostics reuse the actual query inference and reproduce production components',
      queryCalls === 1 && rows.length === response.results.length && rows.every((row, i) => {
        const result = response.results.find((candidate) => candidate.resume.id === row.resumeId)!
        const mean = row.requirements.reduce((sum, requirement) => sum + requirement.weighted, 0) / row.requirements.length
        return Math.abs(result.breakdown.semantic - semantic[i]) < 1e-10 &&
          Math.abs(result.breakdown.lexical - lexical[i]) < 1e-10 && Math.abs(mean - row.semantic) < 1e-10
      }))
  } finally { embedder.embedQueries = embedQueries }
  deleteAllData()
}
