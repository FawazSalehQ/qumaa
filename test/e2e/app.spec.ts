import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')

let application: ElectronApplication
let page: Page
let scratch: string

test.beforeEach(async () => {
  scratch = mkdtempSync(resolve(tmpdir(), 'qumaa-ui-'))
  const packagedExecutable = process.env.QUMAA_E2E_EXECUTABLE

  application = await electron.launch({
    ...(packagedExecutable
      ? { executablePath: isAbsolute(packagedExecutable) ? packagedExecutable : resolve(ROOT, packagedExecutable) }
      : { args: [ROOT] }),
    cwd: ROOT,
    env: {
      ...process.env,
      QUMAA_E2E_USER_DATA: scratch,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    }
  })

  page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterEach(async () => {
  await application?.close()
  rmSync(scratch, { recursive: true, force: true })
})

test('imports, searches, keeps a result tied to its posting, and invalidates it after deletion', async () => {
  await expect(page.getByRole('button', { name: 'Match', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Library/ }).click()
  await page.getByRole('button', { name: 'Paste text' }).click()

  await page.getByPlaceholder('Label (e.g. candidate name)').fill('Taylor Morgan')
  await page.getByPlaceholder('Paste the resume text here…').fill(`Taylor Morgan
taylor.morgan@example.com

WORK EXPERIENCE
Restaurant Group - Training Manager
Jan 2019 - Dec 2025
Designed onboarding programs, coached restaurant teams, maintained operating procedures, and tracked training performance across twelve branches.

SKILLS
Training, coaching, facilitation, SOPs, food safety, restaurant operations`)
  await page.getByRole('button', { name: 'Add to library' }).click()

  await expect(page.getByText('Taylor Morgan', { exact: true }).first()).toBeVisible()
  const addedToast = page.locator('.toast.success').filter({ hasText: 'Added Taylor Morgan' })
  await expect(addedToast).toBeVisible()
  await addedToast.click()
  await expect(addedToast).toHaveCount(0)
  await page.getByRole('button', { name: 'Match', exact: true }).click()

  const originalPosting = {
    position: 'Restaurant Training Manager',
    jobDescription: 'Lead training and onboarding programs across a multi-branch restaurant group.',
    requirements: `Design onboarding and staff training programs
Coach restaurant teams across multiple branches
Maintain SOPs and food-safety standards`,
    education: 'Food-safety trainer certification preferred'
  }

  await expect(page.getByRole('button', { name: 'Find matches' })).toBeDisabled()
  await page.getByLabel('Position').fill(originalPosting.position)
  await page.getByLabel('Job Description').fill(originalPosting.jobDescription)
  await page.getByLabel('Requirements').fill(originalPosting.requirements)
  await page.getByLabel('Education and Certifications').fill(originalPosting.education)
  await page.getByRole('button', { name: 'Find matches' }).click()
  await expect(page.getByRole('button', { name: 'Open details for Taylor Morgan' })).toBeVisible()

  await page.getByRole('button', { name: /Restaurant Training Manager/ }).click()
  await page.getByLabel('Position').fill('A different unsaved position')
  await page.getByLabel('Job Description').fill('A different unsaved description')
  await page.getByLabel('Requirements').fill('Different unsaved requirements')
  await page.getByLabel('Education and Certifications').fill('Different unsaved education')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: /Restaurant Training Manager/ })).toBeVisible()
  await expect(page.getByText('A different unsaved position')).toHaveCount(0)

  await page.getByRole('button', { name: /Restaurant Training Manager/ }).click()
  await expect(page.getByLabel('Position')).toHaveValue(originalPosting.position)
  await expect(page.getByLabel('Job Description')).toHaveValue(originalPosting.jobDescription)
  await expect(page.getByLabel('Requirements')).toHaveValue(originalPosting.requirements)
  await expect(page.getByLabel('Education and Certifications')).toHaveValue(originalPosting.education)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Open details for Taylor Morgan' }).click()
  await page.locator('.detail-foot').getByRole('button', { name: 'Delete' }).click()

  await expect(page.getByLabel('Position')).toHaveValue(originalPosting.position)
  await expect(page.getByLabel('Job Description')).toHaveValue(originalPosting.jobDescription)
  await expect(page.getByLabel('Requirements')).toHaveValue(originalPosting.requirements)
  await expect(page.getByLabel('Education and Certifications')).toHaveValue(originalPosting.education)
  await expect(page.getByRole('button', { name: 'Open details for Taylor Morgan' })).toHaveCount(0)
  await expect(page.getByText(/Import some resumes first/)).toBeVisible()
})

test('exposes the hardened renderer boundary', async () => {
  const boundary = await page.evaluate(() => ({
    hasNamedApi: typeof (window as any).api?.search?.run === 'function',
    hasRequire: typeof (window as any).require,
    hasProcess: typeof (window as any).process,
    isolated: (window as any).process?.contextIsolated
  }))

  expect(boundary).toEqual({
    hasNamedApi: true,
    hasRequire: 'undefined',
    hasProcess: 'undefined',
    isolated: undefined
  })
})
