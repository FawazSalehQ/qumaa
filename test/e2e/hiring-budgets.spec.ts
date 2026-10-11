import { expect, test, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { localeFor, translate, type Language } from '../../src/shared/i18n.js'

const ROOT = resolve(__dirname, '../..')
let application: ElectronApplication | undefined
let page: Page
let scratch: string

async function launchApplication(): Promise<void> {
  const executable = process.env.QUMAA_E2E_EXECUTABLE
  const env: NodeJS.ProcessEnv = { ...process.env, QUMAA_E2E_USER_DATA: scratch, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({
    ...(executable ? { executablePath: isAbsolute(executable) ? executable : resolve(ROOT, executable) } : { args: [ROOT] }),
    cwd: ROOT,
    env
  })
  page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}

test.beforeEach(async () => {
  scratch = mkdtempSync(resolve(tmpdir(), 'qumaa-hiring-budgets-ui-'))
  await launchApplication()
})

test.afterEach(async () => {
  await application?.close()
  application = undefined
  rmSync(scratch, { recursive: true, force: true })
})

// Expectations below are independently worked amounts, not calls to the production calculator.
async function expectAmounts(locator: Locator, language: Language, values: number[]): Promise<void> {
  for (const value of values) {
    await expect(locator).toContainText(new Intl.NumberFormat(localeFor(language), {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(value))
  }
}

function expectCsvRow(csv: string, field: string, value: string, unit = ''): void {
  const cell = (text: string): string => `"${text.replace(/"/g, '""')}"`
  expect(csv.split('\r\n')).toContain([field, value, unit].map(cell).join(','))
}

for (const language of ['en', 'ar'] as const) {
  test(`saves, compares, restores, edits and exports company hiring costs in ${language}`, async ({}, testInfo) => {
    test.setTimeout(180_000)
    const t = (message: string, values?: Record<string, string | number>): string => translate(language, message, values)
    const companyName = language === 'ar' ? 'شركة المدار للتقنية' : 'Northstar Systems'
    const otherCompanyName = language === 'ar' ? 'شركة الأفق' : 'Horizon Engineering'
    const jobName = language === 'ar' ? 'قائد فريق المنصات' : 'Platform lead'
    const planName = language === 'ar' ? 'خطة توظيف يوليو' : 'July hiring plan'
    const nav = () => page.getByRole('navigation')
    const budgets = () => page.locator('.hiring-budgets')
    const field = (name: string) => budgets().getByLabel(t(name), { exact: true })
    const button = (name: string) => budgets().getByRole('button', { name: t(name), exact: true })
    const openCompany = (name: string) => page.getByRole('button', { name: t('Open company {name}', { name }), exact: true })

    if (language === 'ar') {
      await nav().getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'العربية', exact: true }).click()
    }
    await nav().getByRole('button', { name: t('Companies'), exact: true }).click()
    for (const name of [companyName, otherCompanyName]) {
      await page.getByRole('button', { name: t('+ New company'), exact: true }).click()
      await page.getByLabel(t('Company name'), { exact: true }).fill(name)
      await page.getByRole('button', { name: t('Create company'), exact: true }).click()
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }
    // Seed only synthetic job context through the supported app API. All budget writes use the UI.
    const seeded = await page.evaluate(async ({ companyName, otherCompanyName, jobName }) => {
      const companies = await window.api.recruiting.listCompanies()
      const company = companies.find((item) => item.name === companyName)!
      const otherCompany = companies.find((item) => item.name === otherCompanyName)!
      const posting = { position: jobName, jobDescription: '', requirements: '', educationAndCertifications: '' }
      const job = await window.api.recruiting.saveJob({ companyId: company.id, posting, status: 'open', criteria: [],
        budget: { min: 18_000, max: 24_000, currency: 'SAR', period: 'monthly' },
        hiringBudget: { min: 70_000, max: 80_000, currency: 'SAR' } })
      const otherJob = await window.api.recruiting.saveJob({ companyId: otherCompany.id,
        posting: { ...posting, position: 'Other company assignment' }, status: 'open', criteria: [] })
      return { companyId: company.id, otherCompanyId: otherCompany.id, jobId: job.id, otherJobId: otherJob.id }
    }, { companyName, otherCompanyName, jobName })
    await page.reload()
    await nav().getByRole('button', { name: t('Companies'), exact: true }).click()
    await openCompany(companyName).click()
    await button('+ New budget plan').click()
    await field('Budget plan name').fill(planName)
    await expect(field('Linked job').locator(`option[value="${seeded.otherJobId}"]`)).toHaveCount(0)
    await field('Linked job').selectOption(seeded.jobId)
    // Linking a job must not treat its separate compensation or fee budgets as cost-plan inputs.
    await expect(field('Approved period budget (SAR)')).toHaveValue('')
    await field('GOSI scheme').selectOption('compare')
    await field('Salary input').selectOption('components')
    await field('Basic salary (SAR / month)').fill(language === 'ar' ? '١٠٠٠٠' : '10000')
    await field('Housing allowance (SAR / month)').fill(language === 'ar' ? '۲۵۰۰' : '2500')
    await field('Fixed transport allowance (SAR / month)').fill(language === 'ar' ? '١٠٠٠' : '1000')
    await field('Selected budget month').fill('2026-07')
    await field('Forecast start month').fill('2026-06')
    await field('Forecast end month').fill('2026-07')
    await field('Employment start month').fill('2026-07')
    await field('Completed service months at start').fill('0')
    await field('Planned headcount').fill('2')
    await field('Approved period budget (SAR)').fill(language === 'ar' ? '٥٠٠٠٠' : '50000')
    await field('I confirm this plan is for eligible Saudi private-sector employees').check()

    await expect(nav().getByRole('button', { name: t('Settings'), exact: true })).toBeDisabled()
    await expect(nav().getByRole('button', { name: t('Jobs'), exact: true })).toBeDisabled()
    await expect(openCompany(otherCompanyName)).toBeDisabled()
    await expect(page.getByRole('button', { name: t('Edit company'), exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: t('+ New job for company'), exact: true })).toBeDisabled()
    await button('Save budget plan').click()
    await expect(button('Edit budget plan')).toBeVisible()
    await expect(nav().getByRole('button', { name: t('Settings'), exact: true })).toBeEnabled()
    const [saved] = await page.evaluate((id) => window.api.hiringBudgets.list(id), seeded.companyId)
    expect(saved).toMatchObject({ companyId: seeded.companyId, jobId: seeded.jobId, name: planName, inputs: {
      eligibleSaudiPrivateSector: true, scheme: 'compare',
      salary: { mode: 'components', basicHalala: 1_000_000, housingHalala: 250_000, transportHalala: 100_000 },
      selectedMonth: '2026-07', periodStart: '2026-06', periodEnd: '2026-07', employmentStartMonth: '2026-07',
      serviceMonthsAtStart: 0, headcount: 2, approvedBudgetHalala: 5_000_000,
      eos: { includeBasic: true, includeHousing: true, includeTransport: true }
    } })
    expect(saved.calculationVersion).toBeTruthy()

    await expectAmounts(budgets().getByTestId('hiring-month-existing'), language, [1218.75, 12281.25, 1468.75, 562.50, 15531.25, 31062.50])
    await expectAmounts(budgets().getByTestId('hiring-month-new'), language, [1343.75, 12156.25, 1593.75, 562.50, 15656.25, 31312.50])
    // June is before employment: period cost is one active month, not two and not annualized.
    await expectAmounts(budgets().getByTestId('hiring-forecast-existing'), language, [31062.50, 18937.50])
    await expectAmounts(budgets().getByTestId('hiring-forecast-new'), language, [31312.50, 18687.50])

    await application?.close()
    application = undefined
    await launchApplication()
    await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr')
    await nav().getByRole('button', { name: t('Companies'), exact: true }).click()
    await openCompany(companyName).click()
    await expect(button('Edit budget plan')).toBeVisible()
    expect(await page.evaluate((id) => window.api.hiringBudgets.list(id), seeded.companyId)).toEqual([saved])
    await expectAmounts(budgets().getByTestId('hiring-month-new'), language, [15656.25, 31312.50])

    await button('Edit budget plan').click()
    await expect(field('Budget plan name')).toHaveValue(planName)
    await expect(field('Linked job')).toHaveValue(seeded.jobId)
    await expect(field('Basic salary (SAR / month)')).toHaveValue('10000')
    await expect(field('Housing allowance (SAR / month)')).toHaveValue('2500')
    await expect(field('Fixed transport allowance (SAR / month)')).toHaveValue('1000')
    await field('Salary input').selectOption('combined')
    await field('Combined basic + housing (SAR / month)').fill('18000')
    await field('Basic share (%)').fill('75')
    await field('Housing share (%)').fill('25')
    await field('Fixed transport allowance (SAR / month)').fill('2000')
    await button('Save budget plan').click()
    await expect(button('Edit budget plan')).toBeVisible()
    const [edited] = await page.evaluate((id) => window.api.hiringBudgets.list(id), seeded.companyId)
    expect(edited).toMatchObject({ id: saved.id, createdAt: saved.createdAt, companyId: seeded.companyId, jobId: seeded.jobId,
      inputs: { salary: { mode: 'combined', combinedHalala: 1_800_000, basicPercentBps: 7500, housingPercentBps: 2500, transportHalala: 200_000 } } })
    expect(edited.updatedAt).toBeGreaterThan(saved.updatedAt)
    // Basic 13,500 + housing 4,500 + transport 2,000; EOS rounds to 833.33 SAR.
    await expectAmounts(budgets().getByTestId('hiring-month-existing'), language, [1755, 18245, 2115, 833.33, 22948.33, 45896.66])
    await expectAmounts(budgets().getByTestId('hiring-month-new'), language, [1935, 18065, 2295, 833.33, 23128.33, 46256.66])
    await expectAmounts(budgets().getByTestId('hiring-forecast-new'), language, [46256.66, 3743.34])

    // Cancel an edit without losing the saved split or leaving the navigation locked.
    await button('Edit budget plan').click()
    await expect(field('Combined basic + housing (SAR / month)')).toHaveValue('18000')
    await expect(field('Basic share (%)')).toHaveValue('75')
    await expect(field('Housing share (%)')).toHaveValue('25')
    await field('Fixed transport allowance (SAR / month)').fill('9000')
    await button('Cancel').click()
    await expect(button('Edit budget plan')).toBeVisible()
    expect(await page.evaluate((id) => window.api.hiringBudgets.list(id), seeded.companyId)).toEqual([edited])
    await expect(nav().getByRole('button', { name: t('Settings'), exact: true })).toBeEnabled()

    const csvPath = resolve(scratch, `hiring-budget-${language}.csv`)
    await application!.evaluate(({ dialog }, filePath) => {
      ;(dialog as any).showSaveDialog = async () => ({ canceled: false, filePath })
    }, csvPath)
    await button('Export budget CSV').click()
    await expect.poll(() => existsSync(csvPath)).toBe(true)
    const csv = readFileSync(csvPath, 'utf8')
    writeFileSync(testInfo.outputPath(`hiring-budget-${language}.csv`), csv)
    expect(csv.startsWith('\ufeff')).toBe(true)
    expect(csv).toContain(companyName)
    expect(csv).toContain(jobName)
    expect(csv).toContain(planName)
    expect(csv).toContain(saved.id)
    const csvLabel = (en: string, ar: string): string => language === 'ar' ? ar : en
    const currency = csvLabel('SAR', 'ريال سعودي')
    const salary = csvLabel('Salary', 'الراتب')
    expectCsvRow(csv, `${salary} / ${csvLabel('Basic salary', 'الراتب الأساسي')}`, '13500.00', currency)
    expectCsvRow(csv, `${salary} / ${csvLabel('Housing allowance', 'بدل السكن')}`, '4500.00', currency)
    expectCsvRow(csv, `${salary} / ${csvLabel('Gross salary', 'الراتب الإجمالي')}`, '20000.00', currency)
    expectCsvRow(csv, `${salary} / ${csvLabel('GOSI contribution wage', 'أجر الاشتراك في التأمينات')}`, '18000.00', currency)
    const selected = csvLabel('Selected planning month / Scenarios', 'شهر التخطيط المختار / السيناريوهات')
    const forecast = csvLabel('Actual budget-period forecast', 'توقع فترة الميزانية الفعلية')
    const scenarios = csvLabel('Scenarios', 'السيناريوهات')
    const monthlyCost = csvLabel('Monthly employer cost per person', 'تكلفة صاحب العمل الشهرية للفرد')
    expectCsvRow(csv, `${selected} / 1 / ${monthlyCost}`, '22948.33', currency)
    expectCsvRow(csv, `${selected} / 2 / ${monthlyCost}`, '23128.33', currency)
    expectCsvRow(csv, `${selected} / 2 / ${csvLabel('Annualized headcount cost at constant month assumptions', 'التكلفة السنوية لجميع الموظفين بافتراض ثبات بيانات الشهر')}`, '555079.92', currency)
    expectCsvRow(csv, `${forecast} / ${csvLabel('Active employment months in period', 'أشهر العمل الفعلية خلال الفترة')}`, '1')
    expectCsvRow(csv, `${forecast} / ${scenarios} / 2 / ${csvLabel('Period total for headcount', 'إجمالي الفترة لجميع الموظفين')}`, '46256.66', currency)
    expectCsvRow(csv, `${forecast} / ${scenarios} / 2 / ${csvLabel('Remaining approved budget (negative means exceeded)', 'المتبقي من الميزانية المعتمدة (السالب يعني التجاوز)')}`, '3743.34', currency)
    expectCsvRow(csv, `${forecast} / ${scenarios} / 2 / ${csvLabel('Monthly forecast / 1 / Employment active in this month', 'التوقع الشهري / 1 / العمل نشط في هذا الشهر')}`, csvLabel('No', 'لا'))
    await budgets().screenshot({ path: testInfo.outputPath(`hiring-budget-saved-${language}.png`), animations: 'disabled' })
    await budgets().getByTestId('hiring-month-new').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`hiring-budget-selected-${language}.png`), animations: 'disabled' })
    await budgets().getByTestId('hiring-forecast-new').getByText(t('Month-by-month calculation'), { exact: true }).click()
    await budgets().getByTestId('hiring-forecast-new').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`hiring-budget-forecast-${language}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)

    // The company boundary and separate existing job budgets survive plan editing/deletion.
    await openCompany(otherCompanyName).click()
    expect(await page.evaluate((id) => window.api.hiringBudgets.list(id), seeded.otherCompanyId)).toEqual([])
    await expect(button('Edit budget plan')).toHaveCount(0)
    await openCompany(companyName).click()
    await button('Delete budget plan').click()
    await page.getByRole('button', { name: t('Confirm delete budget plan'), exact: true }).click()
    await expect.poll(() => page.evaluate((id) => window.api.hiringBudgets.list(id), seeded.companyId)).toEqual([])
    await expect(button('Edit budget plan')).toHaveCount(0)
    const job = await page.evaluate((id) => window.api.recruiting.getJob(id), seeded.jobId)
    expect(job.job).toMatchObject({ companyId: seeded.companyId,
      budget: { min: 18_000, max: 24_000, currency: 'SAR', period: 'monthly' },
      hiringBudget: { min: 70_000, max: 80_000, currency: 'SAR' } })
  })
}

test('validates explicit inputs and keeps EOS eligibility and service thresholds independent of GOSI', async () => {
  test.setTimeout(90_000)
  await page.getByRole('navigation').getByRole('button', { name: 'Companies', exact: true }).click()
  await page.getByRole('button', { name: '+ New company', exact: true }).click()
  await page.getByLabel('Company name', { exact: true }).fill('Validation Company')
  await page.getByRole('button', { name: 'Create company', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Validation Company', exact: true })).toBeVisible()
  const [company] = await page.evaluate(() => window.api.recruiting.listCompanies())
  const budgets = page.locator('.hiring-budgets')
  const field = (name: string) => budgets.getByLabel(name, { exact: true })
  const save = budgets.getByRole('button', { name: 'Save budget plan', exact: true })
  const noSavedPlan = async (): Promise<void> => {
    expect(await page.evaluate((id) => window.api.hiringBudgets.list(id), company.id)).toEqual([])
  }
  const baseValue = (label: string) => budgets.locator('.hiring-cost-bases > div')
    .filter({ has: page.getByText(label, { exact: true }) }).locator('dd')
  const selected = budgets.getByTestId('hiring-month-new')
  const forecast = budgets.getByTestId('hiring-forecast-new')

  await budgets.getByRole('button', { name: '+ New budget plan', exact: true }).click()
  await field('Budget plan name').fill('Reviewed service threshold')
  const eligibility = field('I confirm this plan is for eligible Saudi private-sector employees')
  await expect(eligibility).not.toBeChecked()
  await eligibility.check()
  for (const name of ['Basic salary (SAR / month)', 'Housing allowance (SAR / month)', 'Fixed transport allowance (SAR / month)']) {
    await expect(field(name)).toHaveValue('')
  }
  // Native custom validation can stop submission before the React save handler runs.
  await save.click()
  await expect(field('Basic salary (SAR / month)')).toHaveAttribute('aria-invalid', 'true')
  expect(await field('Basic salary (SAR / month)').evaluate((input: HTMLInputElement) => input.validationMessage)).toBe('Enter a number.')
  await expect(selected).toHaveCount(0)
  await noSavedPlan()

  await field('Basic salary (SAR / month)').fill('10000')
  await field('Housing allowance (SAR / month)').fill('2500')
  await field('Fixed transport allowance (SAR / month)').fill('1000')
  await field('GOSI scheme').selectOption('new')
  await field('Selected budget month').fill('2026-07')
  await field('Forecast start month').fill('2026-07')
  await field('Forecast end month').fill('2026-08')
  await field('Employment start month').fill('2026-07')
  await field('Completed service months at start').fill('59')
  await field('Planned headcount').fill('1')
  await eligibility.uncheck()
  await save.click()
  await expect(budgets.getByRole('alert')).toContainText('Confirm eligible Saudi private-sector coverage before calculating.')
  await expect(selected).toHaveCount(0)
  await noSavedPlan()
  await eligibility.check()
  await expectAmounts(selected, 'en', [1343.75, 1593.75, 562.50, 15656.25])

  await field('Salary input').selectOption('combined')
  await field('Combined basic + housing (SAR / month)').fill('12500')
  await field('Basic share (%)').fill('75')
  await field('Housing share (%)').fill('30')
  await save.click()
  await expect(budgets.getByRole('alert')).toContainText('Basic and housing percentages must total 100%.')
  await expect(selected).toHaveCount(0)
  await noSavedPlan()
  // Hidden invalid percentages must not poison direct-component entry after switching back.
  await field('Salary input').selectOption('components')
  await expect(field('Basic salary (SAR / month)')).toHaveValue('10000')
  await expect(field('Housing allowance (SAR / month)')).toHaveValue('2500')
  await expect(budgets.getByText('Basic and housing percentages must total 100%.', { exact: true })).toHaveCount(0)
  await expectAmounts(selected, 'en', [1593.75, 562.50, 15656.25])

  await budgets.getByText('GOSI wage settings and verified override', { exact: true }).click()
  await field('Use a separately verified registered GOSI wage').check()
  await field('Verified registered GOSI wage (SAR)').fill('10000')
  await save.click()
  expect(await field('Registered wage verification and reason').evaluate((input: HTMLTextAreaElement) => input.validity.valueMissing)).toBe(true)
  await expect(budgets.getByText('Record the basis for the verified registered GOSI wage.', { exact: true })).toBeVisible()
  await expect(selected).toHaveCount(0)
  await noSavedPlan()
  const verification = 'Synthetic registered-wage fixture reviewed for this test.'
  await field('Registered wage verification and reason').fill(verification)
  await expect(baseValue('Gross monthly salary')).toHaveText('13,500.00 SAR')
  await expect(baseValue('GOSI contribution wage')).toHaveText('10,000.00 SAR')
  await expect(baseValue('EOS eligible monthly wage')).toHaveText('13,500.00 SAR')
  await expectAmounts(selected, 'en', [1075, 1275, 562.50, 15337.50])

  await budgets.getByText('End-of-service eligible components', { exact: true }).click()
  await field('Include fixed transport allowance').uncheck()
  await expect(baseValue('Gross monthly salary')).toHaveText('13,500.00 SAR')
  await expect(baseValue('GOSI contribution wage')).toHaveText('10,000.00 SAR')
  await expect(baseValue('EOS eligible monthly wage')).toHaveText('12,500.00 SAR')
  await expectAmounts(selected, 'en', [1075, 1275, 520.83, 15295.83])
  await expect(selected.getByText('Eligible wage / 24', { exact: true })).toBeVisible()
  await forecast.getByText('Month-by-month calculation', { exact: true }).click()
  const monthRow = (month: string) => forecast.getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: month, exact: true }) })
  await expect(monthRow('2026-07').getByRole('cell')).toHaveText(['10.75% / 12.75%', '520.83 SAR', '15,295.83 SAR'])
  await expect(monthRow('2026-08').getByRole('cell')).toHaveText(['10.75% / 12.75%', '1,041.67 SAR', '15,816.67 SAR'])
  await expectAmounts(forecast, 'en', [31112.50])

  await save.click()
  await expect(budgets.getByRole('button', { name: 'Edit budget plan', exact: true })).toBeVisible()
  const plans = await page.evaluate((id) => window.api.hiringBudgets.list(id), company.id)
  expect(plans).toHaveLength(1)
  expect(plans[0]).toMatchObject({ companyId: company.id, jobId: null, name: 'Reviewed service threshold', inputs: {
    eligibleSaudiPrivateSector: true, scheme: 'new', serviceMonthsAtStart: 59,
    salary: { mode: 'components', basicHalala: 1_000_000, housingHalala: 250_000, transportHalala: 100_000, basicPercentBps: 7500, housingPercentBps: 2500 },
    gosi: { registeredWageHalala: 1_000_000, registeredWageNote: verification },
    eos: { includeBasic: true, includeHousing: true, includeTransport: false }
  } })
  await expectAmounts(selected, 'en', [520.83, 15295.83])
  await expectAmounts(forecast, 'en', [31112.50])
})
