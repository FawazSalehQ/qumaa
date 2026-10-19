import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { translate } from '../../src/shared/i18n.js'
import { launchQumaa } from './launch.js'

const ar = (message: string, values?: Record<string, string | number>): string => translate('ar', message, values)
let application: ElectronApplication | undefined
let page: Page
let scratch: string

async function launch(): Promise<void> {
  ;({ application, page } = await launchQumaa(scratch))
}

async function resize(width: number): Promise<void> {
  await application!.evaluate(({ BrowserWindow }, contentWidth) => {
    const window = BrowserWindow.getAllWindows()[0]
    // Exercise the responsive renderer below the usual desktop minimum too.
    window.setMinimumSize(800, 620)
    window.setContentSize(contentWidth, 860)
  }, width)
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
}

async function noPageOverflow(): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    root: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }))
  expect(metrics.root).toBeLessThanOrEqual(metrics.viewport + 1)
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1)
}

test.beforeEach(async () => {
  scratch = mkdtempSync(resolve(tmpdir(), 'qumaa-arabic-ui-'))
  await launch()
})

test.afterEach(async () => {
  await application?.close()
  application = undefined
  rmSync(scratch, { recursive: true, force: true })
})

test('supports Arabic recruiting, mixed-script data, RTL layouts, and language persistence after restart', async ({}, testInfo) => {
  test.setTimeout(180_000)
  // Fresh local fixtures only. This test never creates a key or enables reranking.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'العربية', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('heading', { name: 'اللغة', exact: true })).toBeVisible()
  const navigation = page.getByRole('navigation')
  await expect(navigation.getByRole('button')).toHaveText([ar('Jobs'), ar('Companies'), ar('Recruiter desk'), `${ar('Library')} ٠`, ar('Settings')])
  await expect(page.getByRole('button', { name: 'Jobs', exact: true })).toHaveCount(0)
  const menuLabels = await application!.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label))
  expect(menuLabels).toContain('ملف')
  await page.screenshot({ path: testInfo.outputPath('arabic-settings.png'), fullPage: true, animations: 'disabled' })

  const invalidLanguage = await page.evaluate(async () => {
    try {
      await (window.api.settings.setLanguage as (value: unknown) => Promise<unknown>)('fr')
      return 'accepted'
    } catch { return 'rejected' }
  })
  expect(invalidLanguage).toBe('rejected')
  expect(await page.evaluate(async () => (await window.api.settings.get()).language)).toBe('ar')

  await page.evaluate(async () => {
    const candidates = [
      ['Layan source', 'Layan Hassan\nlayan.hassan@example.com\n+966 50 111 2233\nRiyadh\n\nWORK EXPERIENCE\nSenior engineer, 2018 to 2025. Built TypeScript APIs and PostgreSQL services. Led a platform team and improved cloud reliability.\nقادت فريق تطوير وأشرفت على تدريب المهندسين وتحسين جودة الخدمات.\n\nSKILLS\nTypeScript, AWS, PostgreSQL'],
      ['Alex source', 'Alex Morgan\nalex.morgan@example.com\n\nWORK EXPERIENCE\nSoftware engineer, 2017 to 2025. Developed TypeScript platforms and Node.js applications, mentored engineers and operated AWS services.\nخبرة في قيادة الفريق وتطوير الخدمات السحابية.\n\nSKILLS\nTypeScript, AWS, Node.js']
    ]
    for (const [label, text] of candidates) {
      const outcome = await window.api.ingest.text(text, label)
      if (outcome.status !== 'imported' && outcome.status !== 'near-duplicate') throw new Error('Could not import fictional Arabic UI fixture')
    }
  })
  await page.reload()
  await resize(1280)
  await page.getByRole('button', { name: new RegExp(`^${ar('Library')}`) }).click()
  await page.getByRole('row').filter({ hasText: 'Layan source' }).click()
  const detail = page.getByRole('dialog', { name: ar('Details for {name}', { name: 'Layan Hassan' }), exact: true })
  await expect(detail).toBeVisible()
  await expect.poll(async () => Math.round((await detail.boundingBox())!.x)).toBe(0)
  await expect(detail.locator('.detail-sub bdi').filter({ hasText: 'layan.hassan@example.com' })).toHaveAttribute('dir', 'ltr')
  await detail.getByRole('button', { name: ar('Add details'), exact: true }).click()
  await detail.getByLabel(ar('Name'), { exact: true }).fill('ليان حسن')
  const email = detail.getByLabel(ar('Email'), { exact: true })
  await email.fill('layan.hassan@example.com')
  await expect(email).toHaveAttribute('dir', 'ltr')
  const years = detail.getByLabel(ar('Years of experience'), { exact: true })
  await years.fill('١٠١')
  await detail.getByRole('button', { name: ar('Save profile'), exact: true }).click()
  await expect(years).toHaveAttribute('aria-invalid', 'true')
  expect(await years.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false)
  await years.fill('۷٫۵')
  await expect(years).toHaveValue('7.5')
  await detail.getByLabel(ar('Expected salary'), { exact: true }).fill('١٨٬٠٠٠ ريال / month')
  await detail.getByLabel(ar('Availability'), { exact: true }).fill('متاحة من أكتوبر')
  await detail.getByLabel(ar('Tags'), { exact: true }).fill('قيادة, Platform')
  await detail.getByLabel(ar('Screening notes'), { exact: true }).fill('تم تأكيد الخبرة في TypeScript خلال الاتصال.')
  await detail.getByRole('button', { name: ar('Save profile'), exact: true }).click()
  await expect(detail.getByText(ar('Recruiter profile saved.'), { exact: true })).toBeVisible()
  await expect(detail.locator('.recruiter-confirmed dd').filter({ hasText: 'layan.hassan@example.com' })).toHaveAttribute('dir', 'ltr')
  await detail.locator('.detail-body').evaluate((element) => { element.scrollTop = 0 })
  await page.screenshot({ path: testInfo.outputPath('arabic-profile.png'), fullPage: true, animations: 'disabled' })
  await noPageOverflow()
  await resize(900)
  await noPageOverflow()
  await detail.getByRole('button', { name: ar('Close'), exact: true }).click()
  await resize(1280)

  // Arabic keyboard digits also work in the Library filter, with canonical values.
  const libraryYears = page.getByLabel(ar('Minimum years of experience'), { exact: true })
  await libraryYears.fill('٧٫٥')
  await expect(libraryYears).toHaveValue('7.5')
  await expect(page.getByRole('row').filter({ hasText: 'Layan source' })).toBeVisible()
  await libraryYears.fill('')
  const newJobShortcut = await application!.evaluate(({ Menu, BrowserWindow }, label) => {
    const item = Menu.getApplicationMenu()!.items.flatMap((entry) => entry.submenu?.items ?? [])
      .find((entry) => entry.label === label)!
    item.click(item, BrowserWindow.getAllWindows()[0], {} as never)
    return item.accelerator
  }, ar('New Job'))
  expect(newJobShortcut).toBe('CmdOrCtrl+N')
  await expect(navigation.getByRole('button', { name: ar('Jobs'), exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('textbox', { name: ar('Position'), exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: ar('Save job'), exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: ar('Find matches'), exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: ar('Cancel'), exact: true }).click()
  const expressEntry = page.getByRole('button', { name: ar('Express search'), exact: true })
  await expect(expressEntry).toBeVisible()
  expect(ar('Express search')).not.toBe('Express search')
  await expect(page.getByRole('button', { name: ar('+ New job'), exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('express-entry-arabic.png'), fullPage: true, animations: 'disabled' })
  await expressEntry.click()
  await expect(page.getByRole('textbox')).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: ar('Position'), exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: ar('Save job'), exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: ar('Use requirement lines'), exact: true })).toHaveCount(1)
  await page.getByLabel(ar('Job description'), { exact: true }).fill('مهندس منصات / Platform Engineer\nتطوير خدمات TypeScript وقيادة فريق لبناء منصة سحابية موثوقة.')
  await page.getByLabel(ar('Requirements'), { exact: true }).fill('TypeScript\nقيادة الفريق')
  await noPageOverflow()
  await page.screenshot({ path: testInfo.outputPath('express-form-arabic.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: ar('Find matches'), exact: true }).click()
  await expect(page.getByText(ar('Express search'), { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'ليان حسن', exact: true })).toBeVisible()
  await expect(page.locator('.recruit-candidate-table tbody .recruit-name')).toHaveCount(2)
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toEqual([])
  await page.getByRole('button', { name: ar('Settings'), exact: true }).click()
  await page.getByRole('button', { name: ar('Jobs'), exact: true }).click()
  await expect(page.getByRole('heading', { name: 'مهندس منصات / Platform Engineer', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ليان حسن', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('express-results-arabic.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: ar('Save as job'), exact: true }).click()
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toHaveLength(1)
  await page.getByRole('button', { name: ar('Edit job'), exact: true }).click()
  await page.getByLabel(ar('Position'), { exact: true }).fill('مهندس منصات / Platform Engineer')
  await page.getByRole('button', { name: ar('Use requirement lines'), exact: true }).click()
  await page.getByLabel(ar('Importance of criterion {count}', { count: 1 }), { exact: true }).selectOption('required')
  const importance = page.getByLabel(ar('Importance of criterion {count}', { count: 2 }), { exact: true })
  await importance.selectOption('preferred')
  await expect(importance).toHaveValue('preferred')
  await page.getByRole('button', { name: ar('Save job'), exact: true }).click()
  await page.getByRole('button', { name: ar('Refresh matches'), exact: true }).click()
  await expect(page.getByRole('button', { name: ar('Review {name}', { name: 'ليان حسن' }), exact: true })).toBeVisible()
  const sidebar = await page.locator('.recruit-job-list').boundingBox()
  const workspace = await page.locator('.recruit-workspace').boundingBox()
  expect(sidebar!.x).toBeGreaterThan(workspace!.x + workspace!.width)
  await page.locator('.recruit-workspace-head').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('arabic-jobs.png'), fullPage: true, animations: 'disabled' })
  await noPageOverflow()

  await page.getByRole('button', { name: ar('Review {name}', { name: 'ليان حسن' }), exact: true }).click()
  await page.getByRole('combobox', { name: ar('Review state'), exact: true }).selectOption('shortlisted')
  const recommendation = 'مرشحة قوية؛ مناقشة قيادة الفريق وملكية خدمات TypeScript.'
  await page.getByRole('textbox', { name: ar('Screening notes / recommendation'), exact: true }).fill(recommendation)
  await page.getByLabel(ar('Assessment: {criterion}', { criterion: 'TypeScript' }), { exact: true }).selectOption('confirmed')
  await page.getByLabel(ar('Evidence note: {criterion}', { criterion: 'TypeScript' }), { exact: true }).fill('تم تأكيد الخبرة في المقابلة الأولية.')

  // A language change updates labels without discarding an open review draft.
  await page.getByRole('button', { name: ar('Settings'), exact: true }).click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await page.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Screening notes / recommendation', exact: true })).toHaveValue(recommendation)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'العربية', exact: true }).click()
  await page.getByRole('button', { name: ar('Jobs'), exact: true }).click()
  await expect(page.getByRole('textbox', { name: ar('Screening notes / recommendation'), exact: true })).toHaveValue(recommendation)
  await page.getByRole('button', { name: ar('Save review'), exact: true }).click()
  await expect(page.getByText(ar('Review saved on this device'), { exact: true })).toBeVisible()
  await page.getByRole('button', { name: ar('Close review'), exact: true }).click()
  await page.getByRole('button', { name: ar('Shortlist {name}', { name: 'Alex Morgan' }), exact: true }).click()
  await expect(page.getByRole('button', { name: ar('Remove {name} from shortlist', { name: 'Alex Morgan' }), exact: true })).toBeEnabled()
  for (const name of ['ليان حسن', 'Alex Morgan']) {
    await page.getByRole('checkbox', { name: ar('Compare {name}', { name }), exact: true }).check()
  }
  await page.getByRole('button', { name: ar('Compare candidates'), exact: true }).click()
  const comparison = page.getByLabel(ar('Candidate comparison table'), { exact: true })
  await expect(comparison.getByText(recommendation, { exact: true })).toBeVisible()
  await expect(comparison.getByText(ar('Recruiter confirmed'), { exact: true })).toBeVisible()
  await comparison.locator('thead').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('arabic-comparison.png'), fullPage: true, animations: 'disabled' })
  const columns = comparison.locator('thead th')
  expect((await columns.first().boundingBox())!.x).toBeGreaterThan((await columns.last().boundingBox())!.x)
  await noPageOverflow()
  await resize(900)
  await noPageOverflow()
  await page.screenshot({ path: testInfo.outputPath('arabic-comparison-900.png'), fullPage: true, animations: 'disabled' })
  await resize(1280)
  await page.getByRole('button', { name: `${ar('Shortlist')} ٢`, exact: true }).click()
  await page.getByRole('button', { name: ar('Move {name} up', { name: 'Alex Morgan' }), exact: true }).click()
  await expect(page.locator('.recruit-candidate-table tbody tr').first()).toContainText('Alex Morgan')
  await page.getByRole('button', { name: ar('Filters'), exact: true }).click()
  const jobYears = page.getByLabel(ar('Min. experience'), { exact: true })
  await jobYears.fill('٧٫٥')
  await expect(jobYears).toHaveValue('7.5')
  await expect(page.locator('.recruit-candidate-table tbody tr').filter({ hasText: 'ليان حسن' })).toBeVisible()
  await page.getByRole('button', { name: ar('Clear filters'), exact: true }).click()

  const csvPath = resolve(scratch, 'arabic-shortlist.csv')
  await application!.evaluate(({ dialog }, filePath) => {
    ;(dialog as any).showSaveDialog = async () => ({ canceled: false, filePath })
  }, csvPath)
  await page.getByRole('button', { name: ar('Export CSV'), exact: true }).click()
  await expect.poll(() => existsSync(csvPath)).toBe(true)
  const csv = readFileSync(csvPath, 'utf8')
  expect(csv).toContain('ليان حسن')
  expect(csv).toContain('layan.hassan@example.com')
  expect(csv).toContain(recommendation)

  const pdfPath = testInfo.outputPath('arabic-shortlist.pdf')
  await application!.evaluate(({ dialog }, filePath) => {
    ;(dialog as any).showSaveDialog = async () => ({ canceled: false, filePath })
  }, pdfPath)
  await page.getByRole('button', { name: ar('Export PDF'), exact: true }).click()
  await expect.poll(() => existsSync(pdfPath)).toBe(true)
  expect(readFileSync(pdfPath).subarray(0, 5).toString('ascii')).toBe('%PDF-')

  await page.getByRole('button', { name: ar('Settings'), exact: true }).click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Jobs', exact: true }).click()
  await page.getByRole('button', { name: 'ليان حسن', exact: true }).click()
  const englishDetail = page.getByRole('dialog', { name: 'Details for Layan Hassan', exact: true })
  await expect(englishDetail).toBeVisible()
  await expect.poll(async () => {
    const bounds = (await englishDetail.boundingBox())!
    return Math.round(bounds.x + bounds.width)
  }).toBe(1280)
  await englishDetail.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'العربية', exact: true }).click()

  await application!.close()
  application = undefined
  await launch()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('button', { name: 'الوظائف', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: `${ar('Shortlist')} ٢`, exact: true })).toBeVisible()
  const persisted = await page.evaluate(async () => {
    const settings = await window.api.settings.get()
    const profiles = await window.api.recruiting.listProfiles()
    const jobs = await window.api.recruiting.listJobs()
    const job = await window.api.recruiting.getJob(jobs[0].id)
    return { settings, profiles, job, resumes: await window.api.resumes.list() }
  })
  expect(persisted.settings.language).toBe('ar')
  expect(persisted.settings.hasApiKey).toBe(false)
  expect(persisted.profiles.find((profile) => profile.name === 'ليان حسن')?.yearsExperience).toBe(7.5)
  expect(persisted.job.job.posting.position).toBe('مهندس منصات / Platform Engineer')
  expect(persisted.job.job.criteria.slice(0, 2).map((criterion) => criterion.importance)).toEqual(['required', 'preferred'])
  expect(persisted.job.job.criteria.slice(2).every((criterion) => criterion.importance === 'unspecified')).toBe(true)
  expect(persisted.job.reviews.some((review) => review.note === recommendation && review.status === 'shortlisted')).toBe(true)
  expect(persisted.resumes.map((resume) => resume.name).sort()).toEqual(['Alex Morgan', 'Layan Hassan'])
})
