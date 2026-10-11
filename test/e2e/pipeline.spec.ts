import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { translate, type Language } from '../../src/shared/i18n.js'

const ROOT = resolve(__dirname, '../..')
let application: ElectronApplication | undefined
let page: Page
let scratch: string
test.beforeEach(async () => {
  scratch = mkdtempSync(resolve(tmpdir(), 'qumaa-pipeline-ui-'))
  const packagedExecutable = process.env.QUMAA_E2E_EXECUTABLE
  const env: NodeJS.ProcessEnv = { ...process.env, QUMAA_E2E_USER_DATA: scratch, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({ ...(packagedExecutable ? { executablePath: isAbsolute(packagedExecutable) ? packagedExecutable : resolve(ROOT, packagedExecutable) } : { args: [ROOT] }), cwd: ROOT, env })
  page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})
test.afterEach(async () => { await application?.close(); application = undefined; rmSync(scratch, { recursive: true, force: true }) })

for (const language of ['en', 'ar'] as Language[]) test(`tracks prospect stages, client submissions and verified screening answers in ${language}`, async ({}, testInfo) => {
  const t = (key: string, values?: Record<string, string | number>): string => translate(language, key, values)
  const seed = await page.evaluate(async (language) => {
    await window.api.settings.setLanguage(language)
    const company = await window.api.recruiting.saveCompany({ name: 'Northstar', industry: 'Technology', location: 'Riyadh', website: '', contactName: 'Dana', contactEmail: '', note: '' })
    const job = await window.api.recruiting.saveJob({ posting: { position: 'Platform lead', jobDescription: 'Lead platform engineering', requirements: '', educationAndCertifications: '' }, companyId: company.id, criteria: [{ id: 'leadership', text: 'Leading technical teams', importance: 'required' }], status: 'open' })
    const person = await window.api.talent.savePerson({ name: 'Maya Prospect', email: 'maya@example.test', phone: '', employer: 'Fictional Labs', title: 'Engineer', location: 'Riyadh', skills: ['TypeScript'], tags: [], availability: 'One month', availabilityConfirmedAt: null, sourceUrl: '', note: 'Internal contact note' })
    return { personId: person.id, jobId: job.id }
  }, language)
  await page.reload()
  await page.getByRole('button', { name: t('Pipeline'), exact: true }).click()
  await page.getByRole('combobox', { name: t('Person to add'), exact: true }).selectOption(seed.personId)
  await page.getByRole('button', { name: t('Add to pipeline'), exact: true }).click()
  const details = page.getByRole('article', { name: t('Pipeline details'), exact: true })
  await expect(details.getByRole('heading', { name: 'Maya Prospect' })).toBeVisible()
  await details.getByRole('button', { name: t('Edit pipeline'), exact: true }).click()
  await page.getByRole('combobox', { name: t('Candidate stage'), exact: true }).selectOption('interested')
  await page.getByRole('textbox', { name: t('Next action'), exact: true }).fill('Arrange screening')
  await page.getByLabel(t('Follow-up due'), { exact: true }).fill('2026-09-23T10:30')
  await page.getByRole('textbox', { name: t('Internal pipeline notes'), exact: true }).fill('Internal-only pipeline note')
  await expect(page.getByRole('button', { name: t('Client pack'), exact: true })).toBeDisabled()
  await page.getByRole('button', { name: t('Save pipeline'), exact: true }).click()
  await expect(details.getByText('Arrange screening', { exact: true })).toBeVisible()

  await details.getByRole('button', { name: t('Log submission'), exact: true }).click()
  await page.getByRole('textbox', { name: t('Recipient'), exact: true }).fill('Dana, Northstar')
  await page.getByRole('textbox', { name: t('Submission notes'), exact: true }).fill('Recruiter sent summary outside the app')
  await page.getByRole('button', { name: t('Save submission'), exact: true }).click()
  await expect(details.getByText('Dana, Northstar', { exact: true })).toBeVisible()
  await details.getByRole('button', { name: t('Record feedback'), exact: true }).click()
  await page.getByRole('textbox', { name: t('Submission feedback'), exact: true }).fill('Please arrange an interview')
  await page.getByRole('button', { name: t('Save feedback'), exact: true }).click()
  await expect(details.getByText('Please arrange an interview', { exact: true })).toBeVisible()

  await details.getByRole('button', { name: t('Prepare screening kit'), exact: true }).click()
  await expect(page.getByRole('textbox', { name: t('Screening title'), exact: true })).toBeVisible()
  await page.getByRole('button', { name: t('Cancel'), exact: true }).click()
  await expect(details.getByText(t('No screenings prepared yet.'), { exact: true })).toBeVisible()
  expect((await page.evaluate(() => window.api.talent.overview())).screenings).toHaveLength(0)

  await details.getByRole('button', { name: t('Prepare screening kit'), exact: true }).click()
  const question = page.getByRole('textbox', { name: t('Question {count}', { count: 1 }), exact: true })
  await expect(question).toHaveValue(/Leading technical teams/)
  if (language === 'ar') await expect(question).toHaveValue(/[\u0600-\u06ff]/)
  await page.getByRole('textbox', { name: t('Screening title'), exact: true }).fill('Leadership screening')
  await page.getByRole('textbox', { name: t('Answer {count}', { count: 1 }), exact: true }).fill('Led a team of six engineers')
  await page.getByRole('combobox', { name: t('Verification {count}', { count: 1 }), exact: true }).selectOption('candidate-stated')
  await page.getByRole('textbox', { name: t('Internal screening notes'), exact: true }).fill('Verify references before offer')
  await page.getByRole('button', { name: t('Save screening'), exact: true }).click()
  await details.locator('summary').filter({ hasText: 'Leadership screening' }).click()
  await expect(details.getByText('Led a team of six engineers', { exact: true })).toBeVisible()
  await expect(details.getByText(t('Candidate stated'))).toBeVisible()
  await details.getByRole('button', { name: t('Edit screening'), exact: true }).click()
  await page.getByRole('textbox', { name: t('Answer {count}', { count: 1 }), exact: true }).fill('Changed claim requires a fresh check')
  await expect(page.getByRole('combobox', { name: t('Verification {count}', { count: 1 }), exact: true })).toHaveValue('unverified')
  await page.getByRole('button', { name: t('Cancel'), exact: true }).click()
  await details.locator('summary').filter({ hasText: 'Leadership screening' }).click()
  await page.screenshot({ path: testInfo.outputPath(`pipeline-${language}.png`), fullPage: true, animations: 'disabled' })

  const records = await page.evaluate(() => window.api.talent.overview())
  const assignment = records.assignments.find((row) => row.jobId === seed.jobId)!
  expect(assignment.stageHistory.map((event) => event.stage)).toEqual(['sourced', 'interested', 'submitted'])
  expect(assignment.submissions[0]).toMatchObject({ companyName: 'Northstar', recipient: 'Dana, Northstar', feedback: 'Please arrange an interview' })
  expect(records.screenings[0].questions[0]).toMatchObject({ answer: 'Led a team of six engineers', verification: 'candidate-stated' })
  expect(records.people[0].recordKeys).toEqual([])

  // A follow-up kit is fresh; cancelling it preserves the earlier saved call.
  await details.getByRole('button', { name: t('Prepare screening kit'), exact: true }).click()
  await expect(page.getByRole('textbox', { name: t('Answer {count}', { count: 1 }), exact: true })).toHaveValue('')
  await page.getByRole('button', { name: t('Cancel'), exact: true }).click()
  await expect(details.getByRole('button', { name: t('Prepare screening kit'), exact: true })).toBeEnabled()
  expect((await page.evaluate(() => window.api.talent.overview())).screenings).toEqual(records.screenings)

  await page.reload()
  await page.getByRole('button', { name: t('Pipeline'), exact: true }).click()
  await expect(details.getByText('Please arrange an interview', { exact: true })).toBeVisible()
  await expect(details.getByText('Arrange screening', { exact: true })).toBeVisible()
  await details.getByRole('button', { name: t('Edit pipeline'), exact: true }).click()
  await page.getByRole('combobox', { name: t('Candidate stage'), exact: true }).selectOption('interviewing')
  await page.getByRole('button', { name: t('Cancel'), exact: true }).click()
  const persisted = await page.evaluate(() => window.api.talent.overview())
  expect(persisted.assignments[0].stage).toBe('submitted')
  await expect(page.getByRole('button', { name: t('Client pack'), exact: true })).toBeEnabled()

  await details.locator('summary').filter({ hasText: 'Leadership screening' }).click()
  await details.getByRole('button', { name: t('Delete screening'), exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: t('Delete this screening?'), exact: true })
  await confirmation.getByRole('button', { name: t('Cancel'), exact: true }).click()
  expect((await page.evaluate(() => window.api.talent.overview())).screenings).toHaveLength(1)
  await details.getByRole('button', { name: t('Delete screening'), exact: true }).click()
  await confirmation.getByRole('button', { name: t('Delete screening'), exact: true }).click()
  await expect(details.getByText(t('No screenings prepared yet.'), { exact: true })).toBeVisible()
  const afterDelete = await page.evaluate(() => window.api.talent.overview())
  expect(afterDelete.screenings).toHaveLength(0)
  expect(afterDelete.assignments).toHaveLength(1)
})
