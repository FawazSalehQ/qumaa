#!/usr/bin/env node
/**
 * Capture Qumaa's interface with disposable fictional data, never the real
 * library. Used to freeze a visual baseline before a redesign and to capture
 * the same screens afterwards for a like-for-like comparison.
 *
 *   npm run build
 *   env -u ELECTRON_RUN_AS_NODE node scripts/capture-ui.mjs --out docs/ui/baseline-2026-10-11/screenshots --label "baseline"
 *
 * Node 22+. Launches the built checkout (out/main/index.js) through the
 * repository's Electron, or a packaged app when --executable is given. Every
 * launch uses a fresh temporary user-data directory that is deleted on exit.
 * No network request is made; optional AI stays off.
 */
import { _electron as electron } from '@playwright/test'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const out = option('--out')
if (!out || args.includes('--help')) {
  console.log('Usage: node scripts/capture-ui.mjs --out <dir> [--label <text>] [--executable <path>] [--width 1440] [--height 1000]')
  process.exit(out ? 0 : 1)
}
const outDir = resolve(root, out)
const label = option('--label') ?? ''
const executable = option('--executable')
const width = Number(option('--width') ?? 1440)
const height = Number(option('--height') ?? 1000)
if (!executable && !existsSync(resolve(root, 'out/main/index.js'))) {
  console.error('Build the app first (npm run build) or pass --executable <packaged app binary>.')
  process.exit(1)
}

/* ---------- fictional seed data (no real people, reserved example domains) ---------- */

const RESUMES = [
  { label: 'Layla Haddad', text: `Layla Haddad
Riyadh, Saudi Arabia
layla.haddad@example.com
+966 50 123 4567

SUMMARY
Senior accountant with nine years in hospitality and retail finance, IFRS reporting and audit coordination across multi-branch operations.

WORK EXPERIENCE
Dunes Hospitality Group — Senior Accountant
Mar 2019 - Present
Prepared monthly IFRS financial statements for twelve restaurant branches.
Led the external audit cycle and reduced the closing calendar from fourteen to six days.
Managed VAT filings, fixed-asset registers and intercompany reconciliations in SAP.

Al Majd Retail — Accountant
Jun 2015 - Feb 2019
Processed payables, payroll journals and bank reconciliations for four stores.

EDUCATION
BSc Accounting, King Saud University, 2015
SOCPA Certified Accountant

SKILLS
IFRS, Financial reporting, Audit, VAT, Excel, SAP, Budgeting, Reconciliation` },
  { label: 'Omar Al-Rashid', text: `Omar Al-Rashid
Jeddah, Saudi Arabia
omar.alrashid@example.com
+966 55 234 5678

SUMMARY
Financial analyst with six years of budgeting, forecasting and management reporting in logistics and distribution.

WORK EXPERIENCE
Red Sea Freight — Senior Financial Analyst
Jan 2021 - Present
Built the annual budget model for nine distribution centres and tracked variances monthly.
Produced management dashboards in Power BI for the executive committee.

Gulf Distribution Co — Financial Analyst
Aug 2018 - Dec 2020
Supported month-end close, cost allocation and cash-flow forecasting.

EDUCATION
BSc Finance, King Abdulaziz University, 2018
CMA candidate

SKILLS
Budgeting, Forecasting, Financial modelling, Power BI, Excel, Oracle, Variance analysis` },
  { label: 'Nadia Qureshi', text: `Nadia Qureshi
Riyadh, Saudi Arabia
nadia.qureshi@example.com
+966 54 345 6789

SUMMARY
HR business partner with eight years supporting operations leaders on workforce planning, performance and employee relations.

WORK EXPERIENCE
Sahara Manufacturing — HR Business Partner
Feb 2020 - Present
Partnered with four plant managers on headcount planning for 600 employees.
Designed the performance review cycle and the Saudization hiring plan.
Advised on grievances, investigations and labour-law compliance.

Oasis Retail — HR Generalist
Sep 2016 - Jan 2020
Ran onboarding, payroll inputs and training coordination for 300 staff.

EDUCATION
BA Human Resource Management, Princess Nourah University, 2016
CIPD Level 5

SKILLS
Workforce planning, Employee relations, Performance management, Recruitment, Labour law, SAP SuccessFactors` },
  { label: 'Tariq Mansour', text: `Tariq Mansour
Dammam, Saudi Arabia
tariq.mansour@example.com
+966 56 456 7890

SUMMARY
Backend engineer with seven years building payment and logistics APIs.

WORK EXPERIENCE
Falak Pay — Senior Backend Engineer
May 2020 - Present
Designed settlement services in Go and PostgreSQL processing two million transactions a day.
Led the migration of thirty services to Kubernetes.

Noor Software — Software Engineer
Jul 2017 - Apr 2020
Built REST APIs in Node.js and TypeScript for a fleet-tracking product.

EDUCATION
BSc Computer Science, King Fahd University of Petroleum and Minerals, 2017

SKILLS
Go, TypeScript, Node.js, PostgreSQL, Kubernetes, Docker, AWS, Kafka` },
  { label: 'Hana Suleiman', text: `Hana Suleiman
Riyadh, Saudi Arabia
hana.suleiman@example.com
+966 53 567 8901

SUMMARY
Registered nurse with ten years in emergency and critical care, charge-nurse experience and clinical education.

WORK EXPERIENCE
Al Salam Medical City — Charge Nurse, Emergency Department
Jan 2018 - Present
Supervised a shift team of fourteen nurses and coordinated triage during peak hours.
Delivered BLS and ACLS refresher training for new graduates.

Wadi Hospital — Staff Nurse, ICU
Mar 2014 - Dec 2017
Provided critical care for ventilated patients and maintained infection-control standards.

EDUCATION
BSN, King Saud bin Abdulaziz University for Health Sciences, 2014
ACLS, BLS

SKILLS
Emergency care, Triage, Critical care, Patient education, Infection control, Clinical training` },
  { label: 'فيصل العتيبي', text: `فيصل العتيبي
الرياض، المملكة العربية السعودية
faisal.alotaibi@example.com
+966 50 678 9012

الملخص المهني
محاسب أول بخبرة ثماني سنوات في إعداد التقارير المالية وفق المعايير الدولية والإشراف على الإقفال الشهري لشركات متعددة الفروع.

الخبرة العملية
مجموعة الواحة للضيافة — محاسب أول
2019 - حتى الآن
أعددت القوائم المالية الشهرية لعشرة فروع وفق المعايير الدولية للتقرير المالي.
نسّقت أعمال المراجعة الخارجية وأشرفت على إقرارات ضريبة القيمة المضافة.
أدرت تسويات البنوك وسجلات الأصول الثابتة على نظام أوراكل.

شركة البحر الأحمر للتجزئة — محاسب
2016 - 2019
عالجت الذمم الدائنة وقيود الرواتب والتسويات البنكية.

المؤهلات العلمية
بكالوريوس محاسبة، جامعة الملك سعود، 2016
زمالة الهيئة السعودية للمراجعين والمحاسبين

المهارات
المعايير الدولية للتقرير المالي، التقارير المالية، المراجعة، ضريبة القيمة المضافة، أوراكل، الموازنات` },
  { label: 'ريم الزهراني', text: `ريم الزهراني
جدة، المملكة العربية السعودية
reem.alzahrani@example.com
+966 55 789 0123

الملخص المهني
أخصائية موارد بشرية بخبرة ست سنوات في التوظيف وتخطيط القوى العاملة وعلاقات الموظفين.

الخبرة العملية
شركة النخيل للخدمات اللوجستية — أخصائية موارد بشرية
2021 - حتى الآن
أدرت دورة التوظيف الكاملة لأكثر من مئة وظيفة سنويًا ونسّقت خطة التوطين.
أعددت تقييمات الأداء السنوية وبرامج التهيئة للموظفين الجدد.

مجموعة الأفق التجارية — منسقة موارد بشرية
2018 - 2021
تابعت الحضور والإجازات ومدخلات الرواتب وملفات الموظفين.

المؤهلات العلمية
بكالوريوس إدارة أعمال، جامعة الملك عبدالعزيز، 2018

المهارات
التوظيف، تخطيط القوى العاملة، علاقات الموظفين، إدارة الأداء، نظام العمل السعودي` },
  { label: 'سارة القحطاني', text: `سارة القحطاني
الدمام، المملكة العربية السعودية
sara.alqahtani@example.com
+966 54 890 1234

الملخص المهني
منسقة لوجستية بخبرة خمس سنوات في إدارة الشحن والمخازن والتخليص الجمركي.

الخبرة العملية
شركة الخليج للنقل — منسقة لوجستية
2020 - حتى الآن
نسّقت شحنات الاستيراد والتصدير لأكثر من ثلاثمئة حاوية شهريًا.
تابعت إجراءات التخليص الجمركي وتقارير المخزون الأسبوعية.

المؤهلات العلمية
دبلوم إدارة سلاسل الإمداد، الكلية التقنية بالدمام، 2019

المهارات
إدارة الشحن، التخليص الجمركي، إدارة المخازن، سلاسل الإمداد، إكسل` }
]

const COMPANIES = [
  { name: 'Dunes Hospitality Group', industry: ['Hospitality', 'Food & Beverage'], location: ['Riyadh'], website: 'https://dunes.example', contactName: ['Sara Al-Amri'], contactEmail: ['sara@dunes.example'], note: 'Growing from 12 to 20 branches in 2027. Prefers candidates with multi-branch reporting experience. Interviews run on Sunday and Tuesday mornings.' },
  { name: 'شركة النخيل للخدمات اللوجستية', industry: ['Logistics', 'لوجستيات'], location: ['جدة', 'الدمام'], website: 'https://nakheel.example', contactName: ['أحمد الغامدي'], contactEmail: ['ahmed@nakheel.example'], note: 'يفضل العميل المرشحين المتاحين خلال شهر.' }
]

/* ---------- seeding runs inside the renderer through the preload bridge ---------- */

async function seed(page) {
  return page.evaluate(async ({ resumes, companies }) => {
    const api = window.api
    const imported = []
    for (const resume of resumes) {
      const outcome = await api.ingest.text(resume.text, resume.label)
      if (outcome.status !== 'imported' && outcome.status !== 'near-duplicate') throw new Error(`Seed import failed for ${resume.label}: ${outcome.status}`)
      imported.push(outcome.resume)
    }
    const savedCompanies = []
    for (const company of companies) savedCompanies.push(await api.recruiting.saveCompany(company))
    const uuid = () => crypto.randomUUID()
    const accountant = await api.recruiting.saveJob({
      companyId: savedCompanies[0].id,
      budget: { min: 14000, max: 18000, currency: 'SAR', period: 'monthly' },
      hiringBudget: { min: 40000, max: 60000, currency: 'SAR' },
      status: 'open',
      posting: {
        position: 'Senior Accountant',
        jobDescription: 'Lead the month-end close and IFRS reporting for a hospitality group with twelve branches. Coordinate the external audit, manage VAT filings and own the fixed-asset register.',
        requirements: 'Five or more years of accounting experience in multi-branch operations\nIFRS financial reporting\nSAP or Oracle ERP experience\nStrong Excel and reconciliation skills',
        educationAndCertifications: 'BSc Accounting\nSOCPA or CPA preferred'
      },
      criteria: [
        { id: uuid(), text: 'Five or more years of accounting experience in multi-branch operations', importance: 'required' },
        { id: uuid(), text: 'IFRS financial reporting', importance: 'required' },
        { id: uuid(), text: 'SOCPA or CPA certification', importance: 'preferred' },
        { id: uuid(), text: 'SAP or Oracle ERP experience', importance: 'unspecified' }
      ]
    })
    const hr = await api.recruiting.saveJob({
      companyId: null,
      status: 'open',
      posting: {
        position: 'HR Business Partner',
        jobDescription: 'Partner with operations leaders on workforce planning, performance cycles and employee relations for a manufacturing group.',
        requirements: 'Workforce planning\nEmployee relations and labour-law knowledge\nPerformance management',
        educationAndCertifications: 'CIPD or SHRM preferred'
      },
      criteria: [
        { id: uuid(), text: 'Workforce planning for 500+ employees', importance: 'required' },
        { id: uuid(), text: 'Saudi labour-law knowledge', importance: 'required' }
      ]
    })
    const accountantWorkspace = await api.recruiting.searchJob(accountant.id)
    const hrWorkspace = await api.recruiting.searchJob(hr.id)
    const results = accountantWorkspace.response?.results ?? []
    if (results.length === 0) throw new Error('Seed search returned no candidates')
    const ref = (match) => ({ id: match.resume.id, recordKey: match.resume.recordKey })
    await api.recruiting.saveReview({ jobId: accountant.id, resume: ref(results[0]), status: 'shortlisted', note: 'Strong IFRS and multi-branch background. Confirm notice period and SAP depth.', order: 1024, assessments: [] })
    if (results[1]) await api.recruiting.saveReview({ jobId: accountant.id, resume: ref(results[1]), status: 'maybe', note: 'Analyst profile; closer to FP&A than core accounting.', order: 2048, assessments: [] })
    if (results[2]) await api.recruiting.saveReview({ jobId: accountant.id, resume: ref(results[2]), status: 'shortlisted', note: '', order: 3072, assessments: [] })
    await api.recruiting.saveProfile({ resume: ref(results[0]), name: null, email: null, phone: null, location: null, yearsExperience: null, educationLevel: null, skills: null, expectedSalary: '16,000 SAR', noticePeriod: '30 days', availability: 'From December', preferredLocation: 'Riyadh', tags: ['finance', 'priority'], note: 'Spoke on the phone; keen on hospitality sector.' })
    const day = 24 * 60 * 60 * 1000
    const now = Date.now()
    const lead = await api.talent.ensurePerson(ref(results[0]))
    await api.talent.saveActivity({ personId: lead.id, jobId: accountant.id, kind: 'call', occurredAt: now - 2 * day, summary: 'Intro call about the Senior Accountant role', outcome: 'Interested', nextAction: 'Send the job description and confirm notice period', dueAt: now + 1 * day, completedAt: null })
    await api.talent.saveAssignment({ personId: lead.id, jobId: accountant.id, stage: 'contacted', nextAction: 'Schedule screening call', dueAt: now + 3 * day, note: '', clientFeedback: '' })
    if (results[1]) {
      const second = await api.talent.ensurePerson(ref(results[1]))
      await api.talent.saveActivity({ personId: second.id, jobId: accountant.id, kind: 'email', occurredAt: now - 5 * day, summary: 'Sent role summary', outcome: 'No reply yet', nextAction: 'Follow up by phone', dueAt: now - 1 * day, completedAt: null })
    }
    const prospect = await api.talent.savePerson({ name: 'Khalid Nasser', email: 'khalid.nasser@example.com', phone: '+966 50 999 1122', employer: 'Gulf Finance House', title: 'Finance Manager', location: 'Dammam', skills: ['IFRS', 'Treasury', 'Team leadership'], tags: ['passive'], availability: '3 months notice', availabilityConfirmedAt: now - 10 * day, sourceUrl: 'https://profiles.example/khalid', note: 'Referred by a client. Not actively looking.' })
    await api.talent.savePool({ name: 'Finance leaders', note: 'Senior finance people worth keeping warm for hospitality clients.', mode: 'manual', filters: { query: '', location: '', employer: '', skill: '', tag: '', availability: '', hasCv: 'any', notContactedSince: null }, personIds: [lead.id, prospect.id] })
    return { accountantJobId: accountant.id, hrJobId: hr.id, companyId: savedCompanies[0].id, candidates: results.length, hrCandidates: hrWorkspace.response?.results.length ?? 0, imported: imported.length }
  }, { resumes: RESUMES, companies: COMPANIES })
}

/* ---------- capture ---------- */

async function main() {
  mkdirSync(outDir, { recursive: true })
  const scratch = mkdtempSync(resolve(tmpdir(), 'qumaa-capture-'))
  const env = { ...process.env, QUMAA_E2E_USER_DATA: scratch, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  const manifest = { label, capturedAt: new Date().toISOString(), gitHead: git('rev-parse HEAD'), gitBranch: git('rev-parse --abbrev-ref HEAD'), workingTreeDirty: git('status --porcelain --untracked-files=no') !== '', target: executable ?? 'built checkout (out/main/index.js)', viewport: { width, height }, syntheticData: true, outboundRequests: 0, screenshots: [] }
  const save = () => writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  let app
  try {
    app = await electron.launch({ ...(executable ? { executablePath: resolve(root, executable) } : { args: [root] }), cwd: root, env })
    await app.evaluate(() => { globalThis.fetch = async () => { throw new Error('UI capture never sends external requests') } })
    const size = async () => app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s.width, s.height), { width, height })
    const page = await app.firstWindow()
    await size()
    page.setDefaultTimeout(45000)
    await page.waitForLoadState('domcontentloaded')
    console.log('Seeding fictional data…')
    const fixture = await seed(page)
    console.log(`Seeded ${fixture.imported} CVs, ${fixture.candidates} matches for the accountant job, ${fixture.hrCandidates} for HR.`)
    await page.evaluate((id) => localStorage.setItem('qumaa-selected-job', id), fixture.accountantJobId)

    const tab = async (index) => { await page.locator('nav.tabs .tab').nth(index).click(); await page.waitForTimeout(200) }
    const reload = async () => { await page.reload(); await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(300) }
    const shot = async (file, meta) => {
      await page.waitForTimeout(250)
      await page.screenshot({ path: resolve(outDir, file), animations: 'disabled' })
      const bytes = readFileSync(resolve(outDir, file))
      manifest.screenshots.push({ file, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), ...meta })
      save()
      console.log(`Captured ${file}`)
    }
    const jobsReady = async () => { await page.locator('.recruit-candidate-table tbody tr').first().waitFor(); await page.waitForTimeout(200) }
    const firstCompany = async () => { await page.locator('.company-list-item').first().click(); await page.locator('.company-detail-head').waitFor() }
    const openDetail = async () => { await page.locator('tbody tr.clickable').first().click(); await page.locator('.detail').waitFor(); await page.waitForTimeout(350) }
    const closeDetail = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250) }
    const setMode = async (language, theme) => {
      await page.evaluate(async ({ language, theme }) => { await window.api.settings.setLanguage(language); await window.api.settings.setTheme(theme) }, { language, theme })
      await reload()
      await page.locator(`html[lang="${language}"]`).waitFor()
    }

    /* English, light */
    await setMode('en', 'light')
    await jobsReady()
    await shot('01-jobs-workspace.png', { language: 'en', theme: 'light', view: 'Jobs: saved job with matches' })
    await page.locator('.recruit-candidate-table tbody tr').first().locator('.recruit-row-actions button').first().click()
    await page.locator('.recruit-review').waitFor()
    await page.locator('.recruit-review').scrollIntoViewIfNeeded()
    await shot('02-jobs-review.png', { language: 'en', theme: 'light', view: 'Jobs: candidate review scorecard' })
    await reload(); await jobsReady()
    await page.locator('.recruit-tabs button').nth(1).click(); await page.waitForTimeout(200)
    await shot('03-jobs-shortlist.png', { language: 'en', theme: 'light', view: 'Jobs: shortlist tab' })
    await page.locator('.recruit-tabs button').nth(4).click(); await page.locator('.job-pipeline').waitFor()
    await shot('04-jobs-pipeline.png', { language: 'en', theme: 'light', view: 'Jobs: pipeline tab' })
    await reload(); await jobsReady()
    await page.getByRole('button', { name: '+ New job', exact: true }).click()
    await page.locator('.recruit-job-editor').waitFor()
    await shot('05-jobs-editor.png', { language: 'en', theme: 'light', view: 'Jobs: new job editor' })
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.locator('.recruit-express-button').click()
    await page.locator('.recruit-express-editor').waitFor()
    await shot('06-jobs-express.png', { language: 'en', theme: 'light', view: 'Jobs: express search form' })
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await tab(1); await firstCompany()
    await shot('07-companies.png', { language: 'en', theme: 'light', view: 'Companies: company workspace' })
    await page.getByRole('button', { name: 'Edit company', exact: true }).click()
    await page.locator('.company-editor').waitFor()
    await shot('08-companies-editor.png', { language: 'en', theme: 'light', view: 'Companies: editor' })
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await tab(2); await page.locator('.talent-tabs').waitFor(); await page.waitForTimeout(400)
    await shot('09-talent-followups.png', { language: 'en', theme: 'light', view: 'Recruiter desk: follow-ups' })
    await page.locator('.talent-tabs > button').nth(1).click(); await page.locator('.talent-layout').waitFor()
    await page.locator('.talent-list-item').first().click(); await page.waitForTimeout(300)
    await shot('10-talent-people.png', { language: 'en', theme: 'light', view: 'Recruiter desk: people' })
    await page.locator('.talent-tabs > button').nth(2).click(); await page.waitForTimeout(300)
    await shot('11-talent-pools.png', { language: 'en', theme: 'light', view: 'Recruiter desk: talent pools' })
    await tab(3); await page.locator('tbody tr.clickable').first().waitFor()
    await shot('12-library.png', { language: 'en', theme: 'light', view: 'Library: table and filters' })
    await openDetail()
    await shot('13-library-detail.png', { language: 'en', theme: 'light', view: 'Library: candidate detail slide-over' })
    await closeDetail()
    await tab(4); await page.locator('.settings-grid').waitFor(); await page.waitForTimeout(400)
    await shot('14-settings.png', { language: 'en', theme: 'light', view: 'Settings' })

    /* English, dark */
    await setMode('en', 'dark')
    await jobsReady()
    await shot('15-dark-jobs.png', { language: 'en', theme: 'dark', view: 'Jobs (dark)' })
    await tab(1); await firstCompany()
    await shot('16-dark-companies.png', { language: 'en', theme: 'dark', view: 'Companies (dark)' })
    await tab(3); await page.locator('tbody tr.clickable').first().waitFor()
    await openDetail()
    await shot('17-dark-library-detail.png', { language: 'en', theme: 'dark', view: 'Library with detail (dark)' })
    await closeDetail()
    await tab(4); await page.locator('.settings-grid').waitFor(); await page.waitForTimeout(400)
    await shot('18-dark-settings.png', { language: 'en', theme: 'dark', view: 'Settings (dark)' })

    /* Arabic, light */
    await setMode('ar', 'light')
    await page.locator('html[dir="rtl"]').waitFor()
    await jobsReady()
    await shot('19-ar-jobs.png', { language: 'ar', theme: 'light', view: 'Jobs (Arabic, RTL)' })
    await tab(1); await firstCompany()
    await shot('20-ar-companies.png', { language: 'ar', theme: 'light', view: 'Companies (Arabic, RTL)' })
    await tab(2); await page.locator('.talent-tabs').waitFor(); await page.waitForTimeout(400)
    await shot('21-ar-talent.png', { language: 'ar', theme: 'light', view: 'Recruiter desk (Arabic, RTL)' })
    await tab(3); await page.locator('tbody tr.clickable').first().waitFor()
    await openDetail()
    await shot('22-ar-library-detail.png', { language: 'ar', theme: 'light', view: 'Library with detail (Arabic, RTL)' })
    await closeDetail()
    await tab(4); await page.locator('.settings-grid').waitFor(); await page.waitForTimeout(400)
    await shot('23-ar-settings.png', { language: 'ar', theme: 'light', view: 'Settings (Arabic, RTL)' })

    /* Arabic, dark */
    await setMode('ar', 'dark')
    await jobsReady()
    await shot('24-ar-dark-jobs.png', { language: 'ar', theme: 'dark', view: 'Jobs (Arabic, dark)' })

    manifest.status = 'completed'
    save()
    console.log(`\n${manifest.screenshots.length} screenshots written to ${outDir}`)
  } catch (error) {
    manifest.status = 'failed'
    manifest.error = error instanceof Error ? error.stack ?? error.message : String(error)
    save()
    throw error
  } finally {
    await app?.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

function git(command) {
  try { return execSync(`git ${command}`, { cwd: root, encoding: 'utf8' }).trim() } catch { return '' }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
