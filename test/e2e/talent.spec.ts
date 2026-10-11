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
  scratch = mkdtempSync(resolve(tmpdir(), 'qumaa-talent-ui-'))
  const packagedExecutable = process.env.QUMAA_E2E_EXECUTABLE
  const env: NodeJS.ProcessEnv = { ...process.env, QUMAA_E2E_USER_DATA: scratch, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({ ...(packagedExecutable ? { executablePath: isAbsolute(packagedExecutable) ? packagedExecutable : resolve(ROOT, packagedExecutable) } : { args: [ROOT] }), cwd: ROOT, env })
  page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})
test.afterEach(async () => { await application?.close(); application = undefined; rmSync(scratch, { recursive: true, force: true }) })

for (const language of ['en', 'ar'] as Language[]) test(`manages prospects, follow-ups, and reusable talent pools in ${language}`, async ({}, testInfo) => {
  test.setTimeout(180_000)
  const t = (key: string, values?: Record<string, string | number>): string => translate(language, key, values)
  const jobId = await page.evaluate(async (language) => {
    await window.api.settings.setLanguage(language)
    return (await window.api.recruiting.saveJob({ posting: { position: 'Platform lead', jobDescription: '', requirements: '', educationAndCertifications: '' }, status: 'open', criteria: [] })).id
  }, language)
  await page.reload()
  await page.getByRole('navigation').getByRole('button', { name: t('Recruiter desk'), exact: true }).click()
  await page.getByRole('button', { name: t('+ New prospect'), exact: true }).click()
  await page.getByRole('textbox', { name: t('Name'), exact: true }).fill('Maya Prospect')
  await page.getByRole('textbox', { name: t('Current employer'), exact: true }).fill('Northstar Labs')
  await page.getByRole('textbox', { name: t('Current role'), exact: true }).fill('Platform engineer')
  await page.getByRole('textbox', { name: t('Location'), exact: true }).fill('Riyadh')
  await page.getByRole('textbox', { name: t('Contact skills'), exact: true }).fill('TypeScript, AWS')
  await page.getByRole('textbox', { name: t('Contact tags'), exact: true }).fill('referral, platform')
  await page.getByRole('textbox', { name: t('Availability'), exact: true }).fill('Available in one month')
  await page.getByRole('textbox', { name: t('Contact notes'), exact: true }).fill('Discuss ownership of platform reliability.')
  await expect(page.getByRole('navigation').getByRole('button', { name: t('Jobs'), exact: true })).toBeDisabled()
  await page.getByRole('button', { name: t('Save contact'), exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Maya Prospect', exact: true })).toBeVisible()
  const person = (await page.evaluate(() => window.api.talent.overview())).people.find((row) => row.name === 'Maya Prospect')!
  expect(person).toMatchObject({ origin: 'prospect', recordKeys: [], employer: 'Northstar Labs', skills: ['TypeScript', 'AWS'], tags: ['referral', 'platform'] })

  await page.getByRole('button', { name: t('Log activity'), exact: true }).first().click()
  await page.getByRole('textbox', { name: t('Activity summary'), exact: true }).fill('Discussed the platform lead opportunity.')
  await page.getByRole('textbox', { name: t('Outcome'), exact: true }).fill('Interested in a technical discussion.')
  await page.getByRole('textbox', { name: t('Next action'), exact: true }).fill('Arrange screening call')
  await page.getByLabel(t('Activity date'), { exact: true }).fill('2026-09-20T09:00')
  await page.getByLabel(t('Follow-up due'), { exact: true }).fill('2026-09-21T10:00')
  await page.getByRole('combobox', { name: t('Related job'), exact: true }).selectOption(jobId)
  await page.getByRole('button', { name: t('Save activity'), exact: true }).click()
  await expect(page.getByText('Discussed the platform lead opportunity.', { exact: true })).toBeVisible()
  const deskTabs = page.getByRole('group', { name: t('Recruiter desk views'), exact: true })
  await deskTabs.getByRole('button').filter({ hasText: t('Follow-ups') }).click()
  await expect(page.getByRole('heading', { name: 'Arrange screening call', exact: true })).toBeVisible()
  await page.getByRole('button', { name: t('Complete follow-up'), exact: true }).click()
  await page.getByRole('combobox', { name: t('Filter follow-ups'), exact: true }).selectOption('completed')
  await page.getByRole('button', { name: t('Reopen follow-up'), exact: true }).click()
  await page.getByRole('combobox', { name: t('Filter follow-ups'), exact: true }).selectOption('all')
  await expect(page.getByRole('heading', { name: 'Arrange screening call', exact: true })).toBeVisible()

  await deskTabs.getByRole('button').filter({ hasText: t('Talent pools') }).click()
  await page.getByRole('button', { name: t('+ New talent pool'), exact: true }).click()
  await page.getByRole('textbox', { name: t('Pool name'), exact: true }).fill('Platform referrals')
  await page.getByRole('button', { name: t('Save talent pool'), exact: true }).click()
  await page.getByRole('combobox', { name: t('Pool member'), exact: true }).selectOption(person.id)
  await page.getByRole('button', { name: t('Add member'), exact: true }).click()
  await page.getByRole('button', { name: t('Mark reviewed'), exact: true }).click()
  await page.getByRole('checkbox', { name: t('New since last review'), exact: true }).check()
  await expect(page.getByText(t('No new people since the last review.'), { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: t('New since last review'), exact: true }).uncheck()
  await expect(page.getByRole('button', { name: 'Maya Prospect', exact: true })).toBeVisible()

  await page.getByRole('button', { name: t('+ New talent pool'), exact: true }).click()
  await page.getByRole('textbox', { name: t('Pool name'), exact: true }).fill('Riyadh platform search')
  await page.getByRole('combobox', { name: t('Pool type'), exact: true }).selectOption('search')
  await page.getByRole('textbox', { name: t('Location'), exact: true }).fill('Riyadh')
  await page.getByRole('textbox', { name: t('Skill'), exact: true }).fill('TypeScript')
  await page.getByRole('combobox', { name: t('CV availability'), exact: true }).selectOption('no')
  await expect(page.getByText(t('{count} people match these filters', { count: 1 }), { exact: true })).toBeVisible()
  await page.getByRole('button', { name: t('Save talent pool'), exact: true }).click()
  await page.getByRole('button', { name: t('Mark reviewed'), exact: true }).click()
  await page.getByRole('button', { name: t('+ New prospect'), exact: true }).click()
  await page.getByRole('textbox', { name: t('Name'), exact: true }).fill('Leila New Prospect')
  await page.getByRole('textbox', { name: t('Location'), exact: true }).fill('Riyadh')
  await page.getByRole('textbox', { name: t('Contact skills'), exact: true }).fill('TypeScript')
  await page.getByRole('button', { name: t('Save contact'), exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Leila New Prospect', exact: true })).toBeVisible()
  await deskTabs.getByRole('button').filter({ hasText: t('Talent pools') }).click()
  await page.getByRole('button', { name: t('Open talent pool {name}', { name: 'Riyadh platform search' }), exact: true }).click()
  await expect(page.getByText(t('{count} new since last review', { count: 1 }), { exact: false })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath(`talent-pools-${language}.png`), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Maya Prospect', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Maya Prospect', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: t('Add to job'), exact: true }).selectOption(jobId)
  await page.getByRole('button', { name: t('Create assignment'), exact: true }).click()
  await expect(page.getByRole('button', { name: t('Refresh desk'), exact: true })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath(`talent-person-${language}.png`), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: t('Open job'), exact: true }).click()
  await expect(page.getByRole('button', { name: t('Pipeline'), exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('article', { name: t('Pipeline details'), exact: true }).getByRole('heading', { name: 'Maya Prospect' })).toBeVisible()

  await page.reload()
  const restored = await page.evaluate(() => window.api.talent.overview())
  expect(restored.people).toHaveLength(2)
  expect(restored.activities[0]).toMatchObject({ personId: person.id, jobId, nextAction: 'Arrange screening call', completedAt: null })
  expect(restored.pools.find((pool) => pool.name === 'Platform referrals')?.members.map((member) => member.personId)).toEqual([person.id])
  expect(restored.pools.find((pool) => pool.name === 'Riyadh platform search')).toMatchObject({ mode: 'search', filters: { location: 'Riyadh', skill: 'TypeScript', hasCv: 'no' } })
  expect(restored.assignments[0]).toMatchObject({ personId: person.id, jobId, stage: 'sourced' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
})
