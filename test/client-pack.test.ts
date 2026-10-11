import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { ClientPackConfig, ClientPackSource } from '../src/shared/client-pack.js'
import type { JobWorkspace } from '../src/shared/recruiting.js'
import type { TalentOverview } from '../src/shared/talent.js'
import { clientPackConfigSchema, clientPackFingerprint, clientPackHtml, clientPackSourceFromRecords, projectClientPack } from '../src/main/export/client-pack.js'

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => Promise<any>>())
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, callback: (...args: any[]) => Promise<any>) => handlers.set(name, callback) }, dialog: { showSaveDialog: vi.fn() } }))
vi.mock('../src/main/recruiting/index.js', () => ({ getJob: vi.fn() }))
vi.mock('../src/main/recruiting/talent.js', () => ({ overview: vi.fn() }))
vi.mock('../src/main/language.js', () => ({ currentLanguage: () => 'en', nativeText: (value: string) => value }))
vi.mock('../src/main/export/shortlist.js', () => ({ writeShortlistPdf: vi.fn() }))
import { dialog } from 'electron'
import { getJob } from '../src/main/recruiting/index.js'
import { overview } from '../src/main/recruiting/talent.js'
import { writeShortlistPdf } from '../src/main/export/shortlist.js'
import { registerClientPackHandlers } from '../src/main/client-pack-ipc.js'

const JOB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PERSON = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const KEY = 'd'.repeat(64)

function source(): ClientPackSource {
  return {
    jobId: JOB, jobTitle: 'Platform lead', criteria: [{ text: 'TypeScript', importance: 'required' }],
    candidates: [{
      personId: PERSON, name: 'Private Candidate', email: 'private@example.com', phone: '+966501112233',
      expectedSalary: 'SAR 24000/month', availability: 'October', noticePeriod: '30 days',
      evidence: [{ id: 'evidence-1', section: 'experience', text: 'Led TypeScript platform delivery.' }],
      answers: [{ id: 'answer-1', question: 'Team scope?', answer: 'Led six engineers.', verification: 'recruiter-verified' }]
    }]
  }
}

function config(): ClientPackConfig {
  return {
    jobId: JOB, firmName: 'Search Partners', introduction: 'Recommended for your review.', blind: true, includeCriteria: false,
    candidates: [{ personId: PERSON, recommendation: 'Strong platform leadership.', includeContact: false, includeCompensation: false, includeAvailability: false, evidenceIds: [], answerIds: [] }]
  }
}

function records(): { workspace: JobWorkspace; talent: TalentOverview } {
  return {
    workspace: {
      job: { id: JOB, posting: { position: 'Platform lead', jobDescription: 'TypeScript platforms', requirements: '', educationAndCertifications: '' }, status: 'open', criteria: [{ id: 'ts', text: 'TypeScript', importance: 'required' }], createdAt: 1, updatedAt: 1, lastSearchedAt: null, candidateCount: 1, shortlistCount: 1, newResumeCount: 0, stale: false },
      reviews: [{ jobId: JOB, candidateKey: KEY, status: 'shortlisted', note: 'SECRET_REVIEW', order: 0, assessments: [], updatedAt: 1 }],
      profiles: [{ candidateKey: KEY, recordKeys: [KEY], name: null, email: null, phone: null, location: null, yearsExperience: null, educationLevel: null, skills: null, expectedSalary: 'SAR 24000/month', availability: 'October', noticePeriod: '30 days', preferredLocation: 'SECRET_LOCATION', tags: ['SECRET_TAG'], note: 'SECRET_PROFILE', updatedAt: 1 }],
      evidence: {}, response: null
    },
    talent: {
      people: [{ id: PERSON, name: 'Private Candidate', email: 'private@example.com', phone: '+966501112233', employer: 'SECRET_EMPLOYER', title: 'Staff engineer', location: 'SECRET_LOCATION', skills: [], tags: [], availability: '', availabilityConfirmedAt: null, sourceUrl: 'https://secret.example', note: 'SECRET_CRM', recordKeys: [KEY], origin: 'library', createdAt: 1, updatedAt: 1 }],
      assignments: [{ id: 'assignment-1', jobId: JOB, personId: PERSON, stage: 'sourced', nextAction: 'SECRET_ACTION', dueAt: null, note: 'SECRET_ASSIGNMENT', clientFeedback: 'SECRET_FEEDBACK', submissions: [], stageHistory: [], createdAt: 1, updatedAt: 1 }],
      activities: [{ id: 'activity-1', personId: PERSON, jobId: JOB, kind: 'call', occurredAt: 1, summary: 'SECRET_ACTIVITY', outcome: '', nextAction: '', dueAt: null, completedAt: null, createdAt: 1, updatedAt: 1 }],
      screenings: [{ id: 'screening-1', personId: PERSON, jobId: JOB, title: 'Call', questions: [
        { id: 'question-1', criterionId: null, question: 'Team scope?', answer: 'Led six engineers.', verification: 'verified', answeredAt: 1 },
        { id: 'question-2', criterionId: null, question: 'Available?', answer: 'October', verification: 'candidate-stated', answeredAt: 1 },
        { id: 'question-3', criterionId: null, question: 'Remote?', answer: 'Discuss flexibility.', verification: 'unverified', answeredAt: null }
      ], heldAt: null, note: 'SECRET_SCREENING_NOTE', createdAt: 1, updatedAt: 1 }], pools: []
    }
  }
}

describe('client presentation data boundary', () => {
  it('excludes internal data at source and projects only deliberately selected fields', () => {
    const fixture = records()
    const picker = clientPackSourceFromRecords(fixture.workspace, fixture.talent)
    expect(picker.candidates[0]).toMatchObject({ personId: PERSON, name: 'Private Candidate', evidence: [], answers: [], email: '', expectedSalary: '' })
    const canonical = clientPackSourceFromRecords(fixture.workspace, fixture.talent, [PERSON])
    expect(JSON.stringify(canonical)).not.toContain('SECRET_')
    expect(JSON.stringify(canonical)).not.toContain('secret.example')
    expect(canonical.candidates[0].answers.map((answer) => answer.verification)).toEqual(['recruiter-verified', 'candidate-stated', 'unverified'])
    const document = projectClientPack(canonical, config(), 'en', 1)
    expect(document.candidates[0]).toEqual({ label: 'Candidate 1', recommendation: 'Strong platform leadership.', contact: [], details: [], evidence: [], answers: [] })
    expect(document.criteria).toEqual([])
  })

  it('suppresses direct identifying fields in blind data even if contact inclusion is forged', () => {
    const input = config()
    input.candidates[0].includeContact = true
    const document = projectClientPack(source(), input, 'en', 1)
    const serialized = JSON.stringify(document)
    for (const identifier of ['Private Candidate', 'private@example.com', '+966501112233', PERSON]) expect(serialized).not.toContain(identifier)
    const named = projectClientPack(source(), { ...input, blind: false }, 'en', 1)
    expect(named.candidates[0].label).toBe('Private Candidate')
    expect(named.candidates[0].contact.map((field) => field.value)).toEqual(['private@example.com', '+966501112233'])
  })

  it('respects cleared contact fields instead of exporting earlier profile values', () => {
    const fixture = records()
    Object.assign(fixture.workspace.profiles[0], { email: 'old@example.com', phone: '+966500000000', availability: 'Outdated availability' })
    Object.assign(fixture.talent.people[0], { email: '', phone: '', availability: '' })
    const canonical = clientPackSourceFromRecords(fixture.workspace, fixture.talent, [PERSON])
    expect(canonical.candidates[0]).toMatchObject({ email: '', phone: '', availability: '' })
    const input = config()
    input.blind = false
    Object.assign(input.candidates[0], { includeContact: true, includeAvailability: true })
    const document = projectClientPack(canonical, input, 'en', 1)
    expect(document.candidates[0].contact).toEqual([])
    expect(document.candidates[0].details).toEqual([{ label: 'Notice period (recruiter recorded)', value: '30 days' }])
    expect(JSON.stringify(document)).not.toContain('old@example.com')
    expect(JSON.stringify(document)).not.toContain('Outdated availability')
  })

  it('preserves selected order and explicit verification without upgrading candidate claims', () => {
    const canonical = source()
    canonical.candidates.push({ ...canonical.candidates[0], personId: OTHER, name: 'Second Candidate' })
    const input = config()
    input.blind = false
    input.includeCriteria = true
    input.candidates = [
      { ...input.candidates[0], personId: OTHER, includeCompensation: true, includeAvailability: true, evidenceIds: ['evidence-1'], answerIds: ['answer-1'] },
      input.candidates[0]
    ]
    const document = projectClientPack(canonical, input, 'en', 1)
    expect(document.candidates.map((candidate) => candidate.label)).toEqual(['Second Candidate', 'Private Candidate'])
    expect(document.candidates[0].details).toHaveLength(3)
    expect(document.candidates[0].answers[0].verification).toBe('recruiter-verified')
    expect(document.candidates[1].details).toEqual([])
    expect(document.criteria).toEqual(canonical.criteria)
  })

  it('binds passage choices to a person’s canonical CV identity and changing text changes the evidence ID', () => {
    const fixture = records()
    const match = (key: string, passage: string) => ({
      resume: { id: 1, recordKey: key, fileName: 'PRIVATE_FILENAME.pdf', filePath: '/PRIVATE_PATH.pdf', importedAt: 1, name: 'Private Candidate', email: null, phone: null, location: null, yearsExperience: null, educationLevel: null, skills: [] },
      score: 1, breakdown: { semantic: 1, lexical: 1, skills: 1 }, matchedSkills: [], missingSkills: [],
      evidence: [{ section: 'experience' as const, text: passage, similarity: 1 }]
    })
    fixture.workspace.response = { sessionId: 'session', requiredSkills: [], totalCandidates: 2, elapsedMs: 1,
      results: [match(KEY, 'Delivered TypeScript services.'), match('e'.repeat(64), 'UNRELATED_PERSON_EVIDENCE')] }
    const first = clientPackSourceFromRecords(fixture.workspace, fixture.talent, [PERSON]).candidates[0]
    expect(first.evidence).toHaveLength(1)
    expect(first.evidence[0].text).toBe('Delivered TypeScript services.')
    expect(JSON.stringify(first)).not.toContain('UNRELATED_PERSON_EVIDENCE')
    expect(JSON.stringify(first)).not.toContain('PRIVATE_FILENAME')
    fixture.workspace.response.results[0].evidence[0].text = 'Updated source passage.'
    const updated = clientPackSourceFromRecords(fixture.workspace, fixture.talent, [PERSON]).candidates[0]
    expect(updated.evidence[0].id).not.toBe(first.evidence[0].id)
  })

  it('rejects arbitrary people, evidence, screening answers, duplicates, and excess selections', () => {
    const input = config()
    expect(() => projectClientPack(source(), { ...input, jobId: OTHER }, 'en', 1)).toThrow('different job')
    expect(() => projectClientPack(source(), { ...input, candidates: [{ ...input.candidates[0], personId: OTHER }] }, 'en', 1)).toThrow('no longer assigned')
    for (const field of ['evidenceIds', 'answerIds'] as const) {
      expect(() => projectClientPack(source(), { ...input, candidates: [{ ...input.candidates[0], [field]: ['foreign-id'] }] }, 'en', 1)).toThrow('changed')
    }
    expect(clientPackConfigSchema.safeParse({ ...input, candidates: [input.candidates[0], input.candidates[0]] }).success).toBe(false)
    expect(clientPackConfigSchema.safeParse({ ...input, candidates: [] }).success).toBe(false)
    expect(clientPackConfigSchema.safeParse({ ...input, candidates: Array(11).fill(input.candidates[0]) }).success).toBe(false)
    expect(clientPackConfigSchema.safeParse({ ...input, rawInternalNotes: 'never' }).success).toBe(false)
    const fixture = records()
    expect(() => clientPackSourceFromRecords(fixture.workspace, fixture.talent, [OTHER])).toThrow('no longer assigned')
    fixture.talent.assignments[0].jobId = OTHER
    expect(clientPackSourceFromRecords(fixture.workspace, fixture.talent).candidates).toEqual([])
  })

  it('escapes every exported text field and has no executable or remote content', () => {
    const payload = '<img src="https://bad.example" onerror="alert(1)"><script>bad()</script>'
    const canonical = source()
    canonical.jobTitle = payload
    canonical.criteria[0].text = payload
    canonical.candidates[0] = { ...canonical.candidates[0], name: payload, email: payload, expectedSalary: payload, evidence: [{ id: 'evidence-1', section: payload, text: payload }], answers: [{ id: 'answer-1', question: payload, answer: payload, verification: 'candidate-stated' }] }
    const input = config()
    input.blind = false; input.firmName = payload; input.introduction = payload; input.includeCriteria = true
    input.candidates[0] = { ...input.candidates[0], recommendation: payload, includeContact: true, includeCompensation: true, evidenceIds: ['evidence-1'], answerIds: ['answer-1'] }
    const html = clientPackHtml(projectClientPack(canonical, input, 'en', 1))
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img src=&quot;https://bad.example&quot;')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('Candidate stated; not independently verified')
  })

  it('localizes the document while retaining authored Arabic and detects changed selected contents', () => {
    const input = config()
    input.candidates[0].recommendation = 'خبرة مناسبة في قيادة الفريق'
    const first = projectClientPack(source(), input, 'ar', Date.UTC(2026, 8, 22))
    const html = clientPackHtml(first)
    expect(html).toContain('<html lang="ar" dir="rtl">')
    expect(html).toContain('المرشح ١')
    expect(html).toContain('خبرة مناسبة في قيادة الفريق')
    expect(html).not.toMatch(/margin-left:|padding-left:|border-left:/)
    const changed = source()
    changed.candidates[0].name = 'New name'
    expect(clientPackFingerprint(projectClientPack(changed, input, 'ar', first.generatedAt))).toBe(clientPackFingerprint(first))
    input.candidates[0].recommendation = 'Different shared recommendation'
    expect(clientPackFingerprint(projectClientPack(source(), input, 'ar', first.generatedAt))).not.toBe(clientPackFingerprint(first))
  })
})

describe('client presentation preview/export consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlers.clear()
    const fixture = records()
    vi.mocked(getJob).mockImplementation(() => fixture.workspace)
    vi.mocked(overview).mockImplementation(() => fixture.talent)
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/client-presentation-test.pdf' })
    registerClientPackHandlers(() => ({} as BrowserWindow))
  })

  const event = { sender: { id: 1 } }
  const invoke = (name: string, input: unknown, sender = event): Promise<any> => handlers.get(`clientPack:${name}`)!(sender, input)

  it('writes only the exact reviewed projection and consumes the preview capability', async () => {
    const input = config()
    const preview = await invoke('preview', input)
    expect(await invoke('export', { config: input, previewToken: preview.previewToken })).toBe('/tmp/client-presentation-test.pdf')
    expect(writeShortlistPdf).toHaveBeenCalledWith(clientPackHtml(preview.document), '/tmp/client-presentation-test.pdf')
    await expect(invoke('export', { config: input, previewToken: preview.previewToken })).rejects.toThrow('expired')
  })

  it('rejects forged sender/config and changed sources before opening a save dialog', async () => {
    const input = config()
    let preview = await invoke('preview', input)
    await expect(invoke('export', { config: { ...input, introduction: 'Changed' }, previewToken: preview.previewToken })).rejects.toThrow('expired')
    preview = await invoke('preview', input)
    await expect(invoke('export', { config: input, previewToken: preview.previewToken }, { sender: { id: 2 } })).rejects.toThrow('expired')
    preview = await invoke('preview', input)
    vi.mocked(getJob).mock.results[0].value.job.posting.position = 'Changed job'
    await expect(invoke('export', { config: input, previewToken: preview.previewToken })).rejects.toThrow('changed')
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
    expect(writeShortlistPdf).not.toHaveBeenCalled()
  })

  it('rechecks after the native save dialog and does not write when an assignment is removed', async () => {
    const input = config()
    const preview = await invoke('preview', input)
    vi.mocked(dialog.showSaveDialog).mockImplementation(async () => {
      vi.mocked(overview).mock.results[0].value.assignments = []
      return { canceled: false, filePath: '/tmp/client-presentation-test.pdf' }
    })
    await expect(invoke('export', { config: input, previewToken: preview.previewToken })).rejects.toThrow('no longer assigned')
    expect(writeShortlistPdf).not.toHaveBeenCalled()
  })

  it('does not write canceled exports or import private notes even when they change during the dialog', async () => {
    const input = config()
    const preview = await invoke('preview', input)
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true })
    expect(await invoke('export', { config: input, previewToken: preview.previewToken })).toBeNull()
    expect(writeShortlistPdf).not.toHaveBeenCalled()
    const next = await invoke('preview', input)
    vi.mocked(dialog.showSaveDialog).mockImplementation(async () => {
      vi.mocked(overview).mock.results[0].value.people[0].note = 'NEW_PRIVATE_NOTE'
      return { canceled: false, filePath: '/tmp/client-presentation-test.pdf' }
    })
    await invoke('export', { config: input, previewToken: next.previewToken })
    expect(vi.mocked(writeShortlistPdf).mock.calls[0][0]).not.toContain('NEW_PRIVATE_NOTE')
  })
})
