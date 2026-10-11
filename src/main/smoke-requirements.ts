/** Backward compatibility and async retrieval seams inside disposable Electron. */
import { closeDbForMaintenance, deleteAllData, getDb, listResumes } from './db/index.js'
import { embedder } from './embed/client.js'
import { backfillResumeDerivedData } from './ingest/derived-backfill.js'
import { ingestText } from './ingest/pipeline.js'
import * as recruiting from './recruiting/index.js'
import { assertRecruitingData } from './recruiting/storage.js'
import type { JobCriterion } from '@shared/recruiting.js'
import { createHash } from 'node:crypto'
import { MODEL_ID } from './embed/protocol.js'
import { RESUME_DERIVATION_VERSION } from './ingest/derivation-version.js'
import { SKILL_GAZETTEER_VERSION } from './ingest/skills-backfill-plan.js'
import { getSetting } from './db/index.js'

type Check = (label: string, ok: boolean, detail?: string) => void

export async function smokeRequirements(check: Check): Promise<void> {
  console.log('\n12. Vacancy requirements and reviewed passage suggestions')
  await backfillResumeDerivedData()
  for (const [index, text] of [
    'Salma Noor\n\nWORK EXPERIENCE\nMuseum Conservator 2017 - 2024\nLed conservation of historic wall paintings, documented pigment deterioration and supervised restoration of fragile frescoes at a municipal museum.',
    'مازن علي\n\nالخبرة المهنية\nمختص ترميم ٢٠١٨ - ٢٠٢٤\nأشرفت على ترميم اللوحات الجدارية التاريخية وتوثيق حالة الأصباغ وحفظ المخطوطات بالتعاون مع أمناء المتحف وفريق المختبر.'
  ].entries()) {
    const result = await ingestText({ text, fileName: `requirements-${index}.md`, filePath: '', fileType: 'md' })
    if (result.status !== 'imported' && result.status !== 'near-duplicate') throw new Error('Could not ingest requirement fixture')
  }
  const resumes = listResumes().map(({ id, recordKey }) => ({ id, recordKey }))
  const posting = { position: 'Museum conservator', jobDescription: 'Oversee historic wall painting conservation', requirements: 'Must document pigment deterioration', educationAndCertifications: '' }
  const legacyCriterion: JobCriterion = { id: 'conservation', text: 'Oversee historic wall painting conservation', importance: 'required' }
  const job = recruiting.saveJob({ posting, status: 'open', criteria: [legacyCriterion] })
  await recruiting.searchJob(job.id)
  recruiting.saveReview({ jobId: job.id, resume: resumes[0], status: 'shortlisted', note: 'Keep recruiter decision', order: 0, assessments: [{ criterionId: legacyCriterion.id, status: 'contradicted', note: 'Recruiter recorded a conflict to clarify' }] })
  const recordData = (): string => JSON.stringify(getDb().prepare('SELECT kind,id,data FROM recruiting_records ORDER BY kind,id').all())
  const beforeRead = recordData()
  closeDbForMaintenance()
  const reopened = recruiting.getJob(job.id)
  check('legacy criteria reopen without invented importance, provenance or stale rankings', !reopened.job.stale && reopened.job.criteria[0].importance === 'required' && reopened.job.criteria[0].source === undefined && recordData() === beforeRead)
  const embedding = embedder.embedQueries
  let calls = 0
  let queryTexts: string[] = []
  embedder.embedQueries = async (texts) => { calls++; queryTexts = texts; return embedding.call(embedder, texts) }
  try {
    const evidence = await recruiting.getEvidence({ jobId: job.id, resumes })
    const passages = getDb().prepare('SELECT text FROM chunks WHERE resume_id = ?')
    check('requirement queries embed once for multiple CVs without source metadata', calls === 1 && JSON.stringify(queryTexts) === JSON.stringify([legacyCriterion.text]))
    check('semantic suggestions cite canonical passages and never confirm qualifications', resumes.every((resume) => {
      const entry = evidence[resume.recordKey][0]
      const stored = passages.all(resume.id) as Array<{ text: string }>
      return entry.reviewNeeded === true && entry.method === 'semantic' && entry.passage !== null && stored.some((row) => row.text.includes(entry.passage!.text)) && !('status' in entry)
    }))
    check('evidence retrieval preserves manual contradiction, rankings and records unchanged', recordData() === beforeRead)
  } finally { embedder.embedQueries = embedding }

  const criterion: JobCriterion = { ...legacyCriterion, importance: 'unspecified', source: { field: 'jobDescription', text: posting.jobDescription } }
  recruiting.saveJob({ id: job.id, posting, status: 'open', criteria: [criterion] })
  const updated = recruiting.getJob(job.id)
  check('source-backed requirements persist and invalidate the old posting snapshot', updated.job.stale && updated.job.criteria[0].source?.text === posting.jobDescription && updated.reviews[0].assessments[0].status === 'contradicted')
  assertRecruitingData(getDb())
  check('portable-data validation accepts old and extended requirement records', true)

  // A deferred model request must not publish suggestions for an edited job.
  const storedVector = getDb().prepare('SELECT embedding FROM chunks LIMIT 1').get() as { embedding: Buffer }
  const vector = new Float32Array(storedVector.embedding.buffer.slice(storedVector.embedding.byteOffset, storedVector.embedding.byteOffset + storedVector.embedding.byteLength))
  let release: ((value: Float32Array[]) => void) | undefined
  embedder.embedQueries = () => new Promise((resolve) => { release = resolve })
  try {
    const pending = recruiting.getEvidence({ jobId: job.id, resumes: [resumes[0]] })
    recruiting.saveJob({ id: job.id, posting, status: 'open', criteria: [{ ...criterion, text: 'Plan archival climate control' }] })
    release!([vector])
    let rejected = false
    try { await pending } catch (error) { rejected = error instanceof Error && error.message.includes('changed while finding') }
    check('criterion edits reject in-flight evidence and reset only changed assessments', rejected && recruiting.getJob(job.id).reviews[0].assessments.length === 0 && recruiting.getJob(job.id).reviews[0].note === 'Keep recruiter decision')
  } finally { embedder.embedQueries = embedding }

  const temporary = await recruiting.searchTemporary({ posting, status: 'open', criteria: [criterion] })
  const temporaryEvidence = await recruiting.getEvidence({ jobId: temporary.job.id, resumes: [resumes[1]] })
  check('unsaved searches retrieve requirement passages without saving a job or review', temporaryEvidence[resumes[1].recordKey][0].reviewNeeded === true && recruiting.listJobs().length === 1 && temporary.reviews.length === 0)
  let modelFailureVisible = false
  embedder.embedQueries = async () => { throw new Error('Requirement embedding unavailable') }
  try { await recruiting.getEvidence({ jobId: temporary.job.id, resumes: [resumes[0]] }) } catch (error) {
    modelFailureVisible = error instanceof Error && error.message === 'Requirement embedding unavailable'
  } finally { embedder.embedQueries = embedding }
  check('model failures remain explicit and never silently substitute a qualification decision', modelFailureVisible)
  // A real previous query-policy fingerprint must request rematching while
  // retaining recruiter state; old scores cannot silently look current.
  await recruiting.searchJob(job.id)
  const snapshotRow = getDb().prepare("SELECT data FROM recruiting_records WHERE kind = 'snapshot' AND id = ?").get(job.id) as { data: string }
  const snapshot = JSON.parse(snapshotRow.data)
  snapshot.modelFingerprint = createHash('sha256').update(JSON.stringify(['recruiting-ranking-v2', MODEL_ID, RESUME_DERIVATION_VERSION, SKILL_GAZETTEER_VERSION, getSetting('embeddingModel')])).digest('hex')
  getDb().prepare("UPDATE recruiting_records SET data = ? WHERE kind = 'snapshot' AND id = ?").run(JSON.stringify(snapshot), job.id)
  const outdated = recruiting.getJob(job.id)
  check('previous query-policy snapshots request refresh and preserve recruiter notes', outdated.job.stale && outdated.reviews[0].note === 'Keep recruiter decision')
  deleteAllData()
}
