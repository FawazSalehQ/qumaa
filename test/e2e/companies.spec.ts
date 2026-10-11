import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { translate } from '../../src/shared/i18n.js'

const ROOT = resolve(__dirname, '../..')
const ar = (message: string, values?: Record<string, string | number>): string => translate('ar', message, values)
let application: ElectronApplication | undefined
let page: Page
let scratch: string

const COMPANY_LIST_FIELDS = [
  { key: 'industry', label: 'Industry' },
  { key: 'location', label: 'Location' },
  { key: 'contactName', label: 'Contact name' },
  { key: 'contactEmail', label: 'Contact email' }
] as const

async function launchApplication(): Promise<void> {
  const packagedExecutable = process.env.QUMAA_E2E_EXECUTABLE
  const env: NodeJS.ProcessEnv = { ...process.env, QUMAA_E2E_USER_DATA: scratch, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({
    ...(packagedExecutable
      ? { executablePath: isAbsolute(packagedExecutable) ? packagedExecutable : resolve(ROOT, packagedExecutable) }
      : { args: [ROOT] }),
    cwd: ROOT,
    env
  })
  page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}

test.beforeEach(async () => {
  scratch = mkdtempSync(resolve(tmpdir(), 'qumaa-companies-ui-'))
  await launchApplication()
})

test.afterEach(async () => {
  await application?.close()
  application = undefined
  rmSync(scratch, { recursive: true, force: true })
})

async function createCompany(name: string, fields: Record<string, string> = {}): Promise<void> {
  await page.getByRole('button', { name: '+ New company', exact: true }).click()
  await page.getByLabel('Company name', { exact: true }).fill(name)
  for (const [label, value] of Object.entries(fields)) {
    await page.getByLabel(label, { exact: true }).fill(value)
    if (COMPANY_LIST_FIELDS.some((field) => field.label === label)) {
      await page.getByRole('button', { name: `Add ${label}`, exact: true }).click()
    }
  }
  await page.getByRole('button', { name: 'Create company', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

test('keeps company jobs, salary and total hiring budgets, and target research separate while preserving recruiter decisions', async ({}, testInfo) => {
  test.setTimeout(180_000)
  // Only synthetic data is loaded, through the app's real local ingest boundary.
  await page.evaluate(async () => {
    const result = await window.api.ingest.text(
      'Maya Stone\nmaya.stone@example.com\n\nWORK EXPERIENCE\nSenior engineer, 2018 to 2025. Built TypeScript services, operated AWS platforms, and coached engineers.\n\nSKILLS\nTypeScript, AWS',
      'Maya Stone'
    )
    if (result.status !== 'imported') throw new Error('Could not import fictional company workflow fixture')
  })
  await page.reload()
  await page.getByRole('navigation').getByRole('button', { name: 'Companies', exact: true }).click()
  await createCompany('Northstar Systems', {
    Industry: 'Software', Location: 'Riyadh', Website: 'https://northstar.example',
    'Contact name': 'Dana Reed', 'Contact email': 'dana@northstar.example', 'Company notes': 'Platform hiring client.'
  })
  await createCompany('Horizon Engineering', { Industry: 'Software', Location: 'Dammam' })
  await page.getByRole('button', { name: 'Open company Northstar Systems', exact: true }).click()
  await page.getByRole('button', { name: 'Edit company', exact: true }).click()
  await page.getByRole('button', { name: 'Remove Riyadh from Location', exact: true }).click()
  await page.getByLabel('Location', { exact: true }).fill('Riyadh / hybrid')
  await page.getByRole('button', { name: 'Add Location', exact: true }).click()
  await page.getByLabel('Company notes', { exact: true }).fill('Platform hiring client; weekly feedback on Thursdays.')
  await page.getByRole('button', { name: 'Save company', exact: true }).click()
  await expect(page.getByText('Riyadh / hybrid', { exact: true })).toBeVisible()
  const companies = await page.evaluate(() => window.api.recruiting.listCompanies())
  const client = companies.find((company) => company.name === 'Northstar Systems')!
  const target = companies.find((company) => company.name === 'Horizon Engineering')!
  expect(client).toMatchObject({
    industry: ['Software'], location: ['Riyadh / hybrid'], website: 'https://northstar.example',
    contactName: ['Dana Reed'], contactEmail: ['dana@northstar.example'],
    note: 'Platform hiring client; weekly feedback on Thursdays.'
  })

  await page.getByRole('button', { name: '+ New job for company', exact: true }).click()
  await expect(page.getByLabel('Hiring company', { exact: true })).toHaveValue(client.id)
  await page.getByLabel('Position', { exact: true }).fill('Platform lead')
  await page.getByLabel('Job description', { exact: true }).fill('Build reliable TypeScript services and coach engineers.')
  await page.getByLabel('Requirements', { exact: true }).fill('TypeScript\nAWS')
  await page.getByRole('checkbox', { name: 'Set salary budget', exact: true }).check()
  await page.getByLabel('Minimum salary', { exact: true }).fill('18000')
  await page.getByLabel('Maximum salary', { exact: true }).fill('24000')
  await expect(page.getByLabel('Currency', { exact: true })).toHaveValue('SAR')
  await expect(page.getByLabel('Pay period', { exact: true })).toHaveValue('monthly')
  await page.getByRole('checkbox', { name: 'Set total hiring budget', exact: true }).check()
  await page.getByLabel('Minimum hiring budget', { exact: true }).fill('50000')
  await page.getByLabel('Maximum hiring budget', { exact: true }).fill('75000')
  await expect(page.getByLabel('Hiring budget currency', { exact: true })).toHaveValue('SAR')
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Platform lead', exact: true })).toBeVisible()
  await expect(page.locator('.recruit-job-context')).toContainText('Northstar Systems')
  await expect(page.locator('.recruit-job-context')).toContainText('18,000–24,000 SAR / month')
  await expect(page.locator('.recruit-job-context')).toContainText('50,000–75,000 SAR')
  const [created] = await page.evaluate(() => window.api.recruiting.listJobs())
  expect(created).toMatchObject({
    companyId: client.id, budget: { min: 18000, max: 24000, currency: 'SAR', period: 'monthly' },
    hiringBudget: { min: 50000, max: 75000, currency: 'SAR' }
  })
  await page.getByRole('button', { name: 'Find matches', exact: true }).click()
  await page.getByRole('button', { name: 'Review Maya Stone', exact: true }).click()
  await page.getByRole('combobox', { name: 'Review state', exact: true }).selectOption('shortlisted')
  await page.getByRole('textbox', { name: 'Screening notes / recommendation', exact: true }).fill('Confirmed interest; discuss platform ownership.')
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Review saved on this device', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close review', exact: true }).click()
  await page.getByRole('button', { name: 'Change status', exact: true }).click()
  const statusDialog = page.getByRole('dialog', { name: 'Change status', exact: true })
  await statusDialog.getByRole('combobox', { name: 'Job status', exact: true }).selectOption('on-hold')
  await statusDialog.getByRole('button', { name: 'Save status', exact: true }).click()
  await expect(statusDialog).toHaveCount(0)
  const reviewed = await page.evaluate((id) => window.api.recruiting.getJob(id), created.id)

  // Target research belongs to the search mandate, independently of the hiring company.
  await page.getByRole('button', { name: /^Target companies/ }).click()
  await page.getByRole('button', { name: 'Edit company map', exact: true }).click()
  const companyToResearch = page.getByLabel('Company to research', { exact: true })
  await expect(companyToResearch.locator(`option[value="${client.id}"]`)).toHaveCount(0)
  await companyToResearch.selectOption(target.id)
  await page.getByRole('button', { name: 'Add target company', exact: true }).click()
  const targetCard = page.getByRole('article', { name: 'Horizon Engineering', exact: true })
  await targetCard.getByLabel('Research status', { exact: true }).selectOption('mapped')
  await targetCard.getByLabel('Target roles', { exact: true }).fill('Staff engineer; platform team lead')
  await targetCard.getByLabel('Research notes', { exact: true }).fill('Research cloud platform teams; validate role scope during screening.')
  await page.getByRole('button', { name: 'Save company map', exact: true }).click()
  await expect.poll(async () => (await page.evaluate((id) => window.api.recruiting.getJob(id), created.id)).job.targetCompanies).toEqual([
    { companyId: target.id, status: 'mapped', focusRoles: 'Staff engineer; platform team lead', note: 'Research cloud platform teams; validate role scope during screening.' }
  ])

  await page.getByRole('button', { name: 'Edit job', exact: true }).click()
  await expect(page.getByLabel('Hiring company', { exact: true })).toHaveValue(client.id)
  await page.getByLabel('Maximum salary', { exact: true }).fill('26000')
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Platform lead', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Platform lead', exact: true })).toBeVisible()
  await expect(page.locator('.recruit-job-context')).toContainText('18,000–26,000 SAR / month')
  await expect(page.locator('.recruit-job-context')).toContainText('50,000–75,000 SAR')
  const restored = await page.evaluate((id) => window.api.recruiting.getJob(id), created.id)
  expect(restored.job).toMatchObject({
    companyId: client.id, budget: { min: 18000, max: 26000, currency: 'SAR', period: 'monthly' },
    hiringBudget: { min: 50000, max: 75000, currency: 'SAR' }, status: 'on-hold', createdAt: reviewed.job.createdAt
  })
  expect(restored.job.statusHistory).toEqual(reviewed.job.statusHistory)
  expect(restored.reviews).toEqual(reviewed.reviews)
  expect(restored.response?.results).toEqual(reviewed.response?.results)
  expect(restored.job.lastSearchedAt).toBe(reviewed.job.lastSearchedAt)
  expect(restored.job.stale).toBe(false)
  expect(restored.job.targetCompanies).toEqual([
    { companyId: target.id, status: 'mapped', focusRoles: 'Staff engineer; platform team lead', note: 'Research cloud platform teams; validate role scope during screening.' }
  ])
  await page.getByRole('button', { name: /^Target companies/ }).click()
  await expect(targetCard.getByText('Mapped', { exact: true })).toBeVisible()
  await expect(targetCard.getByText('Staff engineer; platform team lead', { exact: true })).toBeVisible()
  await page.locator('.recruit-target-companies').screenshot({ path: testInfo.outputPath('company-target-research-english.png'), animations: 'disabled' })
  await page.getByRole('navigation').getByRole('button', { name: 'Companies', exact: true }).click()
  await page.getByRole('button', { name: 'Open company Horizon Engineering', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open job Platform lead', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open company Northstar Systems', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('company-workspace-english.png'), fullPage: true, animations: 'disabled' })
  await page.locator('.company-jobs').screenshot({ path: testInfo.outputPath('company-jobs-budgets-english.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Open job Platform lead', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Platform lead', exact: true })).toBeVisible()

  // A company with no assignments must clear the previous client's workspace.
  const companyFilter = page.getByLabel('Filter by company', { exact: true })
  const savedJobs = page.getByRole('complementary', { name: 'Saved jobs', exact: true })
  await companyFilter.selectOption(client.id)
  await expect(page.getByRole('heading', { name: 'Platform lead', exact: true })).toBeVisible()
  await companyFilter.selectOption(target.id)
  await expect(savedJobs.getByText('No jobs in this view.', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Platform lead', exact: true })).toHaveCount(0)
  await expect(page.locator('.recruit-job-context')).toHaveCount(0)
  await page.getByRole('button', { name: '+ New job', exact: true }).click()
  await expect(page.getByLabel('Hiring company', { exact: true })).toHaveValue(target.id)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(savedJobs.getByText('No jobs in this view.', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Platform lead', exact: true })).toHaveCount(0)
  await expect(page.locator('.recruit-job-context')).toHaveCount(0)
  await companyFilter.selectOption(client.id)
  await expect(page.getByRole('heading', { name: 'Platform lead', exact: true })).toBeVisible()
  await expect(page.locator('.recruit-job-context')).toContainText('Northstar Systems')

  // Express searches do not inherit the directory filter's client assignment.
  // Promotion must make the newly saved unassigned job visible in the sidebar.
  await page.getByRole('button', { name: 'Express search', exact: true }).click()
  await page.getByLabel('Job description', { exact: true }).fill('Independent cloud engineer\nBuild TypeScript services on AWS.')
  await page.getByLabel('Requirements', { exact: true }).fill('TypeScript\nAWS')
  await page.getByRole('button', { name: 'Find matches', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Independent cloud engineer', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save as job', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save as job', exact: true })).toHaveCount(0)
  await expect(savedJobs.getByRole('button', { name: /Independent cloud engineer/ })).toBeVisible()
  await expect(page.locator('.recruit-job-context')).toContainText('No company assigned')
  const promoted = (await page.evaluate(() => window.api.recruiting.listJobs())).find((job) => job.id !== created.id)!
  expect(promoted.companyId ?? null).toBeNull()
  expect(promoted.budget ?? null).toBeNull()
  expect(promoted.hiringBudget ?? null).toBeNull()
  expect(promoted.posting.jobDescription).toBe('Independent cloud engineer\nBuild TypeScript services on AWS.')
})

test('accepts Arabic and Persian amounts, rejects reversed salary ranges, and persists independent budgets in Arabic', async ({}, testInfo) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'العربية', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: ar('Companies'), exact: true }).click()
  await page.getByRole('button', { name: ar('+ New company'), exact: true }).click()
  await page.getByLabel(ar('Company name'), { exact: true }).fill('شركة المدار')
  await page.getByLabel(ar('Location'), { exact: true }).fill('الرياض')
  await page.getByRole('button', { name: ar('Add {field}', { field: ar('Location') }), exact: true }).click()
  await page.getByRole('button', { name: ar('Create company'), exact: true }).click()
  await expect(page.getByRole('heading', { name: 'شركة المدار', exact: true })).toBeVisible()
  await page.getByRole('button', { name: ar('+ New job for company'), exact: true }).click()
  await page.getByLabel(ar('Position'), { exact: true }).fill('قائد فريق المنصات')
  await page.getByRole('checkbox', { name: ar('Set salary budget'), exact: true }).check()
  const minimum = page.getByLabel(ar('Minimum salary'), { exact: true })
  const maximum = page.getByLabel(ar('Maximum salary'), { exact: true })
  const save = page.getByRole('button', { name: ar('Save job'), exact: true })
  await save.click()
  await expect(minimum).toHaveAttribute('aria-invalid', 'true')
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toEqual([])
  await minimum.fill('٢٥٠٠٠')
  await maximum.fill('۱۸۰۰۰')
  await expect(minimum).toHaveValue('25000')
  await expect(maximum).toHaveValue('18000')
  await save.click()
  await expect(maximum).toHaveAttribute('aria-invalid', 'true')
  expect(await maximum.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false)
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toEqual([])
  await minimum.fill('١٨٠٠٠')
  await expect(minimum).toHaveValue('18000')
  await maximum.fill('۲۴۰۰۰')
  await expect(maximum).toHaveValue('24000')
  await page.getByRole('checkbox', { name: ar('Set total hiring budget'), exact: true }).check()
  await page.getByLabel(ar('Minimum hiring budget'), { exact: true }).fill('۵۰۰۰۰')
  await page.getByLabel(ar('Maximum hiring budget'), { exact: true }).fill('٧٥٠٠٠')
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByRole('heading', { name: 'قائد فريق المنصات', exact: true })).toBeVisible()
  const [job] = await page.evaluate(() => window.api.recruiting.listJobs())
  const [company] = await page.evaluate(() => window.api.recruiting.listCompanies())
  expect(job).toMatchObject({
    companyId: company.id, budget: { min: 18000, max: 24000, currency: 'SAR', period: 'monthly' },
    hiringBudget: { min: 50000, max: 75000, currency: 'SAR' }
  })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.getByRole('button', { name: ar('Edit job'), exact: true }).click()
  await expect(minimum).toHaveValue('18000')
  await expect(maximum).toHaveValue('24000')
  await expect(page.getByLabel(ar('Minimum hiring budget'), { exact: true })).toHaveValue('50000')
  await expect(page.getByLabel(ar('Maximum hiring budget'), { exact: true })).toHaveValue('75000')
  await expect(page.getByLabel(ar('Hiring company'), { exact: true })).toHaveValue(company.id)
  await page.screenshot({ path: testInfo.outputPath('company-budget-arabic.png'), fullPage: true, animations: 'disabled' })
  await page.locator('.recruit-budget-editor').nth(1).screenshot({ path: testInfo.outputPath('company-total-budget-arabic.png'), animations: 'disabled' })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.getByRole('checkbox', { name: ar('Set salary budget'), exact: true }).uncheck()
  await save.click()
  await expect(page.getByRole('heading', { name: 'قائد فريق المنصات', exact: true })).toBeVisible()
  const salaryRemoved = await page.evaluate((id) => window.api.recruiting.getJob(id), job.id)
  expect(salaryRemoved.job.budget ?? null).toBeNull()
  expect(salaryRemoved.job.hiringBudget).toEqual({ min: 50000, max: 75000, currency: 'SAR' })
  expect(salaryRemoved.job.companyId).toBe(company.id)
})

for (const language of ['en', 'ar'] as const) {
  test(`keeps multiple company details and independent contacts through editing and restart in ${language}`, async ({}, testInfo) => {
    test.setTimeout(120_000)
    const t = (message: string, values?: Record<string, string | number>): string => translate(language, message, values)
    if (language === 'ar') {
      await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'العربية', exact: true }).click()
    }
    await page.getByRole('navigation').getByRole('button', { name: t('Companies'), exact: true }).click()
    await page.getByRole('button', { name: t('+ New company'), exact: true }).click()
    const name = language === 'ar' ? 'شركة الآفاق المتعددة' : 'Northstar Group'
    const values = language === 'ar' ? {
      industry: ['تقنية المعلومات، والبيانات', 'خدمات الطاقة', 'الخدمات اللوجستية'],
      location: ['الرياض، المملكة العربية السعودية', 'الخبر', 'جدة'],
      contactName: ['دانا عبد الله', 'نورة سالم', 'سارة حسن'],
      contactEmail: ['dana@northstar.example', 'nora@northstar.example', 'hiring@northstar.example']
    } : {
      industry: ['Software, data & AI', 'Energy services', 'Logistics'],
      location: ['Riyadh, Saudi Arabia', 'Al Khobar', 'Jeddah'],
      contactName: ['Dana Reed', 'Nora Salem', 'Sara Hasan'],
      contactEmail: ['dana@northstar.example', 'nora@northstar.example', 'hiring@northstar.example']
    }
    const remove = (label: string, value: string) => page.getByRole('button', {
      name: t('Remove {value} from {field}', { value, field: t(label) }), exact: true
    })
    const add = (label: string) => page.getByRole('button', {
      name: t('Add {field}', { field: t(label) }), exact: true
    })
    await page.getByLabel(t('Company name'), { exact: true }).fill(name)

    // Both Add and Enter retain whole entries, including punctuation in names/places.
    for (const { key, label } of COMPANY_LIST_FIELDS) {
      const input = page.getByLabel(t(label), { exact: true })
      await input.fill(values[key][0])
      await add(label).click()
      await expect(input).toHaveValue('')
      await expect(remove(label, values[key][0])).toBeVisible()
      await input.fill(values[key][1])
      await input.press('Enter')
      await expect(input).toHaveValue('')
      await expect(remove(label, values[key][1])).toBeVisible()
    }
    await page.getByLabel(t('Location'), { exact: true }).press('Enter')
    await expect(page.getByLabel(t('Company name'), { exact: true })).toHaveValue(name)
    expect(await page.evaluate(() => window.api.recruiting.listCompanies())).toEqual([])

    const location = page.getByLabel(t('Location'), { exact: true })
    const mistake = language === 'ar' ? 'فرع غير صحيح' : 'Wrong branch'
    await location.fill(mistake)
    await add('Location').click()
    await remove('Location', mistake).click()
    await expect(remove('Location', mistake)).toHaveCount(0)

    // A duplicate or invalid email stays editable instead of becoming a chip.
    const email = page.getByLabel(t('Contact email'), { exact: true })
    const duplicate = values.contactEmail[0].toUpperCase()
    await email.fill(duplicate)
    await add('Contact email').click()
    await expect(email).toHaveValue(duplicate)
    await expect(remove('Contact email', values.contactEmail[0])).toHaveCount(1)
    await expect(remove('Contact email', duplicate)).toHaveCount(0)
    await email.fill('not-an-email')
    await add('Contact email').click()
    await expect(email).toHaveValue('not-an-email')
    await expect(remove('Contact email', 'not-an-email')).toHaveCount(0)
    await page.getByRole('button', { name: t('Create company'), exact: true }).click()
    await expect(page.getByLabel(t('Company name'), { exact: true })).toHaveValue(name)
    expect(await page.evaluate(() => window.api.recruiting.listCompanies())).toEqual([])

    // Contact lists are independent. Save also captures the last unadded value
    // in every field, without requiring an extra Add click before saving.
    await remove('Contact email', values.contactEmail[1]).click()
    for (const { key, label } of COMPANY_LIST_FIELDS) {
      await page.getByLabel(t(label), { exact: true }).fill(values[key][2])
    }
    await page.getByRole('button', { name: t('Create company'), exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    const expected = { ...values, contactEmail: [values.contactEmail[0], values.contactEmail[2]] }
    const [saved] = await page.evaluate(() => window.api.recruiting.listCompanies())
    expect(saved).toMatchObject({ name, ...expected })
    for (const { key } of COMPANY_LIST_FIELDS) {
      for (const value of expected[key]) await expect(page.locator('.company-details').getByText(value, { exact: true })).toBeVisible()
    }

    await page.getByRole('button', { name: t('Edit company'), exact: true }).click()
    for (const { key, label } of COMPANY_LIST_FIELDS) {
      await expect(page.getByLabel(t(label), { exact: true })).toHaveValue('')
      for (const value of expected[key]) await expect(remove(label, value)).toBeVisible()
    }
    await page.screenshot({ path: testInfo.outputPath(`company-multiple-fields-editor-${language}.png`), fullPage: true, animations: 'disabled' })

    // Cancelling removal of every value restores all lists, including unpaired contacts.
    for (const { key, label } of COMPANY_LIST_FIELDS) {
      for (const value of expected[key]) {
        await remove(label, value).click()
        await expect(remove(label, value)).toHaveCount(0)
      }
    }
    await page.getByRole('button', { name: t('Cancel'), exact: true }).click()
    const [afterCancel] = await page.evaluate(() => window.api.recruiting.listCompanies())
    expect(afterCancel).toEqual(saved)
    await page.getByRole('button', { name: t('Edit company'), exact: true }).click()
    for (const { key, label } of COMPANY_LIST_FIELDS) {
      for (const value of expected[key]) await expect(remove(label, value)).toBeVisible()
    }
    await page.getByRole('button', { name: t('Cancel'), exact: true }).click()

    const filter = page.getByLabel(t('Filter companies'), { exact: true })
    const openCompany = () => page.getByRole('button', { name: t('Open company {name}', { name }), exact: true })
    for (const { key } of COMPANY_LIST_FIELDS) {
      await filter.fill(expected[key][1])
      await expect(openCompany()).toBeVisible()
    }
    await filter.fill('company-that-does-not-exist')
    await expect(openCompany()).toHaveCount(0)
    await filter.fill('')
    await page.reload()
    await page.getByRole('navigation').getByRole('button', { name: t('Companies'), exact: true }).click()
    await openCompany().click()
    expect((await page.evaluate(() => window.api.recruiting.listCompanies()))[0]).toEqual(saved)

    // Restart the real process with the same local workspace, not just the renderer.
    await application?.close()
    application = undefined
    await launchApplication()
    await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr')
    await page.getByRole('navigation').getByRole('button', { name: t('Companies'), exact: true }).click()
    await openCompany().click()
    expect((await page.evaluate(() => window.api.recruiting.listCompanies()))[0]).toEqual(saved)
    await page.screenshot({ path: testInfo.outputPath(`company-multiple-fields-saved-${language}.png`), fullPage: true, animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: t('Edit company'), exact: true }).click()
    for (const { key, label } of COMPANY_LIST_FIELDS) {
      await expect(page.getByLabel(t(label), { exact: true })).toHaveValue('')
      for (const value of expected[key]) await expect(remove(label, value)).toBeVisible()
    }
    await page.getByRole('button', { name: t('Cancel'), exact: true }).click()
  })
}
