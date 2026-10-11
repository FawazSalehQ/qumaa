import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { translate, type Language } from '../../src/shared/i18n.js'

const ROOT = resolve(__dirname, '../..')
let application: ElectronApplication | undefined
let page: Page
let scratch: string
async function launch(): Promise<void> {
  const executable = process.env.QUMAA_E2E_EXECUTABLE
  const env: NodeJS.ProcessEnv = { ...process.env, QUMAA_E2E_USER_DATA: scratch, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({ ...(executable ? { executablePath: isAbsolute(executable) ? executable : resolve(ROOT, executable) } : { args: [ROOT] }), cwd: ROOT, env })
  page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}
test.beforeEach(async () => { scratch = mkdtempSync(resolve(tmpdir(), 'qumaa-requirements-ui-')); await launch() })
test.afterEach(async () => { await application?.close(); application = undefined; rmSync(scratch, { recursive: true, force: true }) })

for (const language of ['en', 'ar'] as Language[]) test(`edits source-backed requirements and inspects cross-language passages in ${language}`, async ({}, testInfo) => {
  const t = (message: string, values?: Record<string, string | number>): string => translate(language, message, values)
  const seed = await page.evaluate(async (language) => {
    await window.api.settings.setLanguage(language)
    await window.api.ingest.text('سلمى نور\n\nالخبرة المهنية\nمختصة ترميم ٢٠١٧ - ٢٠٢٤\nأشرفت على ترميم اللوحات الجدارية التاريخية وتوثيق حالة الأصباغ وحفظ المخطوطات بالتعاون مع أمناء المتحف وفريق المختبر.', 'Museum portfolio')
    const legacy = await window.api.recruiting.saveJob({ posting: { position: 'Legacy vacancy', jobDescription: 'Care for archives', requirements: '', educationAndCertifications: '' }, status: 'open', criteria: [{ id: 'legacy', text: 'Archive care', importance: 'required' }] })
    return { legacyId: legacy.id, resume: (await window.api.resumes.list())[0] }
  }, language)
  await page.reload()
  await page.getByRole('button', { name: t('+ New job'), exact: true }).click()
  await page.getByLabel(t('Position'), { exact: true }).fill('Conservation vacancy')
  await page.getByLabel(t('Job description'), { exact: true }).fill('Plan conservation of historic wall paintings')
  await page.getByLabel(t('Requirements'), { exact: true }).fill('Required qualifications:\nDocument pigment deterioration\nPreferred skills:\nICOMOS')
  await page.getByRole('button', { name: t('Use requirement lines'), exact: true }).click()
  await expect(page.getByLabel(t('Importance of criterion {count}', { count: 1 }), { exact: true })).toHaveValue('required')
  await expect(page.getByLabel(t('Importance of criterion {count}', { count: 2 }), { exact: true })).toHaveValue('preferred')
  await expect(page.getByLabel(t('Importance of criterion {count}', { count: 3 }), { exact: true })).toHaveValue('unspecified')
  await page.getByLabel(t('Criterion {count}', { count: 1 }), { exact: true }).fill('Document pigment deterioration in historic paintings')
  await page.getByRole('button', { name: t('Use requirement lines'), exact: true }).click()
  await expect(page.locator('.recruit-criterion-row')).toHaveCount(3)
  await page.locator('.recruit-criterion-source summary').first().click()
  await expect(page.locator('.recruit-criterion-source blockquote').first()).toHaveText('Document pigment deterioration')
  await page.getByRole('button', { name: t('Save job'), exact: true }).click()
  await page.getByRole('button', { name: t('Find matches'), exact: true }).click()
  await page.getByRole('button', { name: t('Review {name}', { name: seed.resume.name ?? seed.resume.fileName }), exact: true }).click()
  await expect(page.locator('.recruit-passage blockquote').first()).toContainText('ترميم اللوحات الجدارية')
  await expect(page.getByLabel(t('Assessment: {criterion}', { criterion: 'Document pigment deterioration in historic paintings' }), { exact: true })).toHaveValue('unreviewed')
  await page.getByLabel(t('Assessment: {criterion}', { criterion: 'Document pigment deterioration in historic paintings' }), { exact: true }).selectOption('contradicted')
  await page.getByRole('button', { name: t('Save review'), exact: true }).click()
  await expect(page.getByText(t('Review saved on this device'), { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath(`requirements-${language}.png`), fullPage: true, animations: 'disabled' })
  const before = await page.evaluate(async () => (await window.api.recruiting.listJobs()).find((job) => job.posting.position === 'Conservation vacancy')!)
  await application!.close(); application = undefined
  await launch()
  const after = await page.evaluate(async ({ id, legacyId }) => ({ job: await window.api.recruiting.getJob(id), legacy: await window.api.recruiting.getJob(legacyId) }), { id: before.id, legacyId: seed.legacyId })
  expect(after.job.job.criteria).toEqual(before.criteria)
  expect(after.job.reviews[0].assessments[0].status).toBe('contradicted')
  expect(after.legacy.job.criteria).toEqual([{ id: 'legacy', text: 'Archive care', importance: 'required' }])

  await page.getByRole('button', { name: t('Express search'), exact: true }).click()
  await page.getByLabel(t('Job description'), { exact: true }).fill('Conserve historic paintings')
  await page.getByLabel(t('Requirements'), { exact: true }).fill('Review pigment deterioration')
  await page.getByRole('button', { name: t('Use requirement lines'), exact: true }).click()
  await page.getByRole('button', { name: t('Find matches'), exact: true }).click()
  await page.getByRole('button', { name: t('Requirement passages for {name}', { name: seed.resume.name ?? seed.resume.fileName }), exact: true }).click()
  const passages = page.getByRole('region', { name: t('Requirement passages'), exact: true })
  await expect(passages.locator('.recruit-passage blockquote').first()).toContainText('ترميم اللوحات الجدارية')
  await expect(passages.getByRole('combobox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: t('Save review'), exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toHaveLength(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
