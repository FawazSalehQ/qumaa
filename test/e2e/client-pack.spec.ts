import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { extractText } from 'unpdf'
import { translate } from '../../src/shared/i18n.js'
import { launchQumaa } from './launch.js'

let application: ElectronApplication | undefined
let page: Page
let scratch: string

test.beforeEach(async () => {
  scratch = mkdtempSync(resolve(tmpdir(), 'qumaa-client-pack-ui-'))
  ;({ application, page } = await launchQumaa(scratch))
})

test.afterEach(async () => {
  await application?.close()
  application = undefined
  rmSync(scratch, { recursive: true, force: true })
})

test('builds an explicitly selected blind client pack, writes the reviewed PDF, and rejects a stale export', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const seeded = await page.evaluate(async () => {
    const imported = await window.api.ingest.text('Maya Stone\nmaya.stone@example.com\n+966501112233\n\nWORK EXPERIENCE\nPlatform engineer, 2018 to 2025. Led TypeScript platform delivery, operated AWS services, and coached six engineers.\n\nSKILLS\nTypeScript, AWS', 'Maya Stone')
    if (imported.status !== 'imported') throw new Error('Could not import fictional pack fixture')
    const resume = { id: imported.resume.id, recordKey: imported.resume.recordKey }
    const job = await window.api.recruiting.saveJob({
      posting: { position: 'Platform leadership', jobDescription: 'Lead reliable TypeScript platforms and coach engineers.', requirements: 'TypeScript', educationAndCertifications: '' }, status: 'open',
      criteria: [{ id: 'typescript', text: 'TypeScript', importance: 'required' }, { id: 'leadership', text: 'Team leadership', importance: 'required' }]
    })
    await window.api.recruiting.searchJob(job.id)
    const person = await window.api.talent.ensurePerson(resume)
    await window.api.talent.savePerson({ id: person.id, expectedUpdatedAt: person.updatedAt,
      name: person.name, email: person.email, phone: person.phone, employer: 'PRIVATE_EMPLOYER', title: 'Staff engineer', location: 'Riyadh', skills: person.skills, tags: [],
      availability: 'Available in October', availabilityConfirmedAt: null, sourceUrl: 'https://private-source.example', note: 'PRIVATE_CRM_NOTE'
    })
    await window.api.recruiting.saveProfile({ resume, name: null, email: null, phone: null, location: null, yearsExperience: null, educationLevel: null, skills: null,
      expectedSalary: 'SAR 24000/month', noticePeriod: '30 days', availability: 'Available in October', preferredLocation: '', tags: [], note: 'PRIVATE_PROFILE_NOTE' })
    await window.api.recruiting.saveReview({ jobId: job.id, resume, status: 'shortlisted', note: 'PRIVATE_REVIEW_NOTE', order: 1, assessments: [] })
    await window.api.talent.saveAssignment({ personId: person.id, jobId: job.id, stage: 'screened', nextAction: '', dueAt: null, note: 'PRIVATE_ASSIGNMENT_NOTE', clientFeedback: 'PRIVATE_CLIENT_FEEDBACK' })
    const screening = await window.api.talent.generateScreening({ personId: person.id, jobId: job.id })
    await window.api.talent.saveScreening({ id: screening.id, expectedUpdatedAt: screening.updatedAt, title: screening.title, heldAt: Date.now(), note: 'PRIVATE_SCREENING_NOTE',
      questions: screening.questions.map((question, index) => ({ ...question, answer: index === 0 ? 'Delivered three production services.' : 'Coached six engineers.', verification: index === 0 ? 'verified' : 'candidate-stated', answeredAt: Date.now() })) })
    return { jobId: job.id, personId: person.id, resume }
  })
  await page.reload()
  await page.getByRole('button', { name: 'Client pack', exact: true }).click()
  const builder = page.getByRole('region', { name: 'Client presentation builder', exact: true })
  await builder.getByLabel('Recruiter or firm name', { exact: true }).fill('Northstar Search')
  await builder.getByLabel('Client-facing introduction', { exact: true }).fill('A focused recommendation for your platform team.')
  await builder.getByLabel('Add person to presentation', { exact: true }).selectOption(seeded.personId)
  await builder.getByRole('button', { name: 'Add to presentation', exact: true }).click()
  const selection = builder.getByRole('article', { name: 'Presentation selection: Maya Stone', exact: true })
  await selection.getByLabel('Client-facing recommendation', { exact: true }).fill('Strong platform delivery with demonstrated coaching experience.')
  await selection.getByLabel('Include expected compensation', { exact: true }).check()
  await selection.getByLabel('Include availability and notice period', { exact: true }).check()
  await expect(selection.getByLabel('Include email and phone', { exact: true })).toBeDisabled()
  await selection.getByText('Choose CV evidence (up to 3)', { exact: true }).click()
  const evidenceChoice = selection.locator('.client-pack-choices').first().locator('.client-pack-choice').filter({ hasText: 'Led TypeScript platform delivery' }).first().getByRole('checkbox')
  await expect(evidenceChoice).toBeEnabled()
  await evidenceChoice.check()
  await selection.getByText('Choose screening answers (up to 10)', { exact: true }).click()
  const answers = selection.locator('.client-pack-choices').nth(1).getByRole('checkbox')
  await expect(answers).toHaveCount(2)
  await answers.nth(0).check()
  await answers.nth(1).check()
  await builder.getByRole('button', { name: 'Preview client presentation', exact: true }).click()
  const preview = page.getByRole('region', { name: 'Exact client presentation preview', exact: true })
  await expect(preview.getByRole('heading', { name: 'Candidate 1', exact: true })).toBeVisible()
  await expect(preview).toContainText('Strong platform delivery with demonstrated coaching experience.')
  await expect(preview).toContainText('SAR 24000/month')
  await expect(preview).toContainText('Recruiter verified')
  await expect(preview).toContainText('Candidate stated; not independently verified')
  await expect(preview).not.toContainText('PRIVATE_')
  await expect(preview).not.toContainText('maya.stone@example.com')
  // CV text can still identify a candidate, so the preview must state that limit.
  await expect(preview).toContainText('Selected free text may still identify a person.')
  await preview.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('client-presentation-preview.png'), fullPage: true, animations: 'disabled' })
  const pdfPath = resolve(scratch, 'client-presentation.pdf')
  await application!.evaluate(({ dialog }, filePath) => {
    ;(globalThis as any).packSaveDialogCount = 0
    ;(dialog as any).showSaveDialog = async () => { (globalThis as any).packSaveDialogCount++; return { canceled: false, filePath } }
  }, pdfPath)
  await builder.getByRole('button', { name: 'Export reviewed PDF', exact: true }).click()
  await expect.poll(() => existsSync(pdfPath)).toBe(true)
  const bytes = readFileSync(pdfPath)
  writeFileSync(testInfo.outputPath('client-presentation.pdf'), bytes)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  const extracted = await extractText(new Uint8Array(bytes), { mergePages: true })
  expect(extracted.text).toContain('Strong platform delivery')
  expect(extracted.text).toContain('SAR 24000/month')
  expect(extracted.text).not.toContain('PRIVATE_')
  expect(extracted.text).not.toContain('maya.stone@example.com')

  const stale = await page.evaluate(async ({ jobId, personId, resume }) => {
    const config = { jobId, firmName: '', introduction: '', blind: true, includeCriteria: false,
      candidates: [{ personId, recommendation: '', includeContact: false, includeCompensation: true, includeAvailability: false, evidenceIds: [], answerIds: [] }] }
    const preview = await window.api.clientPack.preview(config)
    const profile = (await window.api.recruiting.listProfiles()).find((item) => item.recordKeys.includes(resume.recordKey))!
    await window.api.recruiting.saveProfile({ resume, name: profile.name, email: profile.email, phone: profile.phone, location: profile.location, yearsExperience: profile.yearsExperience,
      educationLevel: profile.educationLevel, skills: profile.skills, expectedSalary: 'SAR 30000/month', noticePeriod: profile.noticePeriod, availability: profile.availability,
      preferredLocation: profile.preferredLocation, tags: profile.tags, note: profile.note })
    try { await window.api.clientPack.export({ config, previewToken: preview.previewToken }); return 'incorrectly exported' }
    catch (failure) { return String(failure) }
  }, seeded)
  expect(stale).toContain('The client presentation changed')
  expect(await application!.evaluate(() => (globalThis as any).packSaveDialogCount)).toBe(1)

  // A new preview follows the current UI language and cannot reuse the old token.
  await builder.getByRole('button', { name: 'Reset presentation', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'العربية', exact: true }).click()
  const ar = (message: string): string => translate('ar', message)
  await page.getByRole('navigation').getByRole('button', { name: ar('Jobs'), exact: true }).click()
  await page.getByRole('button', { name: ar('Client pack'), exact: true }).click()
  await page.getByLabel(ar('Add person to presentation'), { exact: true }).selectOption(seeded.personId)
  await page.getByRole('button', { name: ar('Add to presentation'), exact: true }).click()
  await page.getByLabel(ar('Client-facing recommendation'), { exact: true }).fill('خبرة مناسبة في قيادة الفريق وتطوير المنصات.')
  await page.getByRole('button', { name: ar('Preview client presentation'), exact: true }).click()
  const arabicPreview = page.getByRole('region', { name: ar('Exact client presentation preview'), exact: true })
  await expect(arabicPreview).toContainText('المرشح ١')
  await expect(arabicPreview).toContainText('خبرة مناسبة في قيادة الفريق وتطوير المنصات.')
  expect(await arabicPreview.evaluate((element) => getComputedStyle(element).direction)).toBe('rtl')
  await page.screenshot({ path: testInfo.outputPath('client-presentation-preview-arabic.png'), fullPage: true, animations: 'disabled' })
  const arabicPdfPath = resolve(scratch, 'client-presentation-arabic.pdf')
  await application!.evaluate(({ dialog }, filePath) => {
    ;(dialog as any).showSaveDialog = async () => ({ canceled: false, filePath })
  }, arabicPdfPath)
  await page.getByRole('button', { name: ar('Export reviewed PDF'), exact: true }).click()
  await expect.poll(() => existsSync(arabicPdfPath)).toBe(true)
  const arabicPdfBytes = readFileSync(arabicPdfPath)
  expect(arabicPdfBytes.subarray(0, 5).toString()).toBe('%PDF-')
  writeFileSync(testInfo.outputPath('client-presentation-arabic.pdf'), arabicPdfBytes)
})

test('refreshes presentation choices after desk changes without discarding authored recommendations', async () => {
  const seed = await page.evaluate(async () => {
    const job = await window.api.recruiting.saveJob({ posting: { position: 'Platform lead', jobDescription: '', requirements: '', educationAndCertifications: '' }, status: 'open', criteria: [] })
    const person = await window.api.talent.savePerson({ name: 'Maya Prospect', email: '', phone: '', employer: '', title: '', location: '', skills: [], tags: [], availability: '', availabilityConfirmedAt: null, sourceUrl: '', note: '' })
    await window.api.talent.saveAssignment({ personId: person.id, jobId: job.id, stage: 'sourced', nextAction: '', dueAt: null, note: '', clientFeedback: '' })
    return { jobId: job.id, personId: person.id }
  })
  await page.reload()
  await page.getByRole('button', { name: 'Client pack', exact: true }).click()
  const builder = page.getByRole('region', { name: 'Client presentation builder', exact: true })
  await builder.getByRole('combobox', { name: 'Add person to presentation', exact: true }).selectOption(seed.personId)
  await builder.getByRole('button', { name: 'Add to presentation', exact: true }).click()
  const selection = builder.getByRole('article', { name: 'Presentation selection: Maya Prospect', exact: true })
  await selection.getByRole('textbox', { name: 'Client-facing recommendation', exact: true }).fill('Keep this authored recommendation while I update the desk.')
  const nav = page.getByRole('navigation')
  await nav.getByRole('button', { name: 'Recruiter desk', exact: true }).click()
  await page.getByRole('button', { name: '+ New prospect', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Leila Prospect')
  await page.getByRole('button', { name: 'Save contact', exact: true }).click()
  await page.getByRole('combobox', { name: 'Add to job', exact: true }).selectOption(seed.jobId)
  await page.getByRole('button', { name: 'Create assignment', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh desk', exact: true })).toBeEnabled()
  await nav.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(selection.getByRole('textbox', { name: 'Client-facing recommendation', exact: true })).toHaveValue('Keep this authored recommendation while I update the desk.')
  await builder.getByRole('combobox', { name: 'Add person to presentation', exact: true }).selectOption({ label: 'Leila Prospect' })
  await builder.getByRole('button', { name: 'Add to presentation', exact: true }).click()
  await expect(builder.getByRole('article', { name: 'Presentation selection: Leila Prospect', exact: true })).toBeVisible()

  // A deleted contact stays as an explicit unavailable selection until removed,
  // so the recruiter's written recommendation can still be recovered.
  await nav.getByRole('button', { name: 'Recruiter desk', exact: true }).click()
  await page.getByRole('group', { name: 'Recruiter desk views', exact: true }).getByRole('button').filter({ hasText: 'People' }).click()
  await page.getByRole('button', { name: 'Open contact Maya Prospect', exact: true }).click()
  await page.getByRole('button', { name: 'Delete prospect', exact: true }).click()
  await page.getByRole('dialog', { name: 'Delete this prospect?', exact: true }).getByRole('button', { name: 'Delete prospect and history', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh desk', exact: true })).toBeEnabled()
  await nav.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(selection.getByRole('textbox', { name: 'Client-facing recommendation', exact: true })).toHaveValue('Keep this authored recommendation while I update the desk.')
  await expect(selection.getByRole('alert')).toContainText('This person is no longer assigned to the job.')
  await expect(builder.getByRole('button', { name: 'Preview client presentation', exact: true })).toBeDisabled()
  await selection.getByRole('button', { name: 'Remove Maya Prospect from presentation', exact: true }).click()
  await expect(builder.getByRole('button', { name: 'Preview client presentation', exact: true })).toBeEnabled()
  await builder.getByRole('button', { name: 'Preview client presentation', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Exact client presentation preview', exact: true })).toBeVisible()
})
