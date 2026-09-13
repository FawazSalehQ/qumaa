/* Capture current Qumaa UI using disposable fictional data, never the real library.
 * Run with Node 22: env -u ELECTRON_RUN_AS_NODE node presentations/source/capture-guide.cjs
 * Arabic entry point imports this capture workflow with its own fictional fixture.
 * Real API calls are blocked; only the review screen uses a synthetic protected key.
 */
const { _electron: electron, expect } = require('@playwright/test')
const { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, dirname } = require('node:path')
const { createHash } = require('node:crypto')
const ts = require('typescript')
const root = resolve(__dirname, '../..')
const messages = {}
for (const file of ['common', 'recruiting', 'matching', 'native', 'exports']) {
  const exports = {}
  const source = readFileSync(resolve(root, 'src/shared/locales', `${file}.ts`), 'utf8')
  Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports)
  Object.assign(messages, ...Object.values(exports))
}

async function captureGuide({ language, seed }) {
  const output = resolve(root, language === 'ar' ? 'presentations/arabic/screenshots' : 'presentations/screenshots')
  const scratch = mkdtempSync(resolve(tmpdir(), `qumaa-guide-${language}-`))
  const executablePath = process.env.QUMAA_GUIDE_EXECUTABLE || resolve(root, 'release/mac-arm64/قُمع.app/Contents/MacOS/قُمع')
  const manifest = []
  const appAsarPath = resolve(dirname(executablePath), '../Resources/app.asar')
  const appAsarSha256 = createHash('sha256').update(readFileSync(appAsarPath)).digest('hex')
  const t = (message, values = {}) => (language === 'ar' ? messages[message] || message : message).replace(/\{(\w+)\}/g, (token, name) => typeof values[name] === 'number' ? new Intl.NumberFormat(language === 'ar' ? 'ar-SA' : 'en-US').format(values[name]) : values[name] ?? token)
  const env = { ...process.env, QUMAA_E2E_USER_DATA: scratch, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  let app
  try {
    mkdirSync(output, { recursive: true })
    app = await electron.launch({ executablePath, cwd: root, env })
    const appVersion = await app.evaluate(({ app }) => app.getVersion())
    await app.evaluate(({ safeStorage }) => {
      globalThis.fetch = async () => { throw new Error('Guide captures never send external requests') }
      safeStorage.isEncryptionAvailable = () => false
      safeStorage.decryptString = () => { throw new Error('Guide captures never decrypt credentials') }
    })
    const size = async (height = 1100) => {
      await app.evaluate(({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0].setSize(1440, height), height)
    }
    await size()
    const page = await app.firstWindow()
    page.setDefaultTimeout(30000)
    await page.waitForLoadState('domcontentloaded')
    console.log(`Seeding fictional ${language} fixture.`)
    const fixture = await page.evaluate(seed)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', language)
    const button = (message, values) => page.getByRole('button', { name: t(message, values), exact: true })
    const top = async () => { await page.evaluate(() => { document.querySelector('main').scrollTop = 0 }); await page.waitForTimeout(100) }
    const jobs = async () => { await button('Jobs').click(); await top() }
    const library = async () => { await page.getByRole('button', { name: language === 'ar' ? /^المكتبة/ : /^Library/ }).click(); await top() }
    const saveManifest = () => writeFileSync(resolve(output, 'manifest.json'), JSON.stringify({
      appVersion, capturedAt: new Date().toISOString(), executablePath, appAsarPath, appAsarSha256, source: 'Final packaged macOS application',
      language, direction: language === 'ar' ? 'rtl' : 'ltr', scenario: 'Fictional restaurant training manager vacancy and fictional candidates',
      syntheticUserData: true, realCredentialsUsed: false, syntheticCredentialUsedOnlyForReview: true, outboundRequests: 0,
      imagesReadyToFit: true, screenshots: manifest
    }, null, 2) + '\n')
    const capture = async (file, locators = [], region = 'Application window') => {
      await page.waitForTimeout(150)
      const targets = Array.isArray(locators) ? locators : [locators]
      let clip
      if (targets.length) {
        await targets[0].evaluate(element => {
          element.scrollIntoView({ block: 'start', behavior: 'instant' })
          const main = document.querySelector('main')
          if (main.contains(element)) {
            const safeTop = Math.max(main.getBoundingClientRect().top, document.querySelector('.topbar').getBoundingClientRect().bottom) + 12
            main.scrollTop -= Math.max(0, safeTop - element.getBoundingClientRect().top)
          }
        })
        await page.waitForTimeout(100)
        let boxes = await Promise.all(targets.map(target => target.boundingBox()))
        if (boxes.some(box => !box)) throw new Error(`Missing capture region for ${file}`)
        let x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y))
        let right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height))
        if (bottom - y > 950) {
          await size(Math.min(2400, Math.ceil(bottom - y + 180)))
          await targets[0].evaluate(element => {
          element.scrollIntoView({ block: 'start', behavior: 'instant' })
          const main = document.querySelector('main')
          if (main.contains(element)) {
            const safeTop = Math.max(main.getBoundingClientRect().top, document.querySelector('.topbar').getBoundingClientRect().bottom) + 12
            main.scrollTop -= Math.max(0, safeTop - element.getBoundingClientRect().top)
          }
        })
          await page.waitForTimeout(100)
          boxes = await Promise.all(targets.map(target => target.boundingBox()))
          x = Math.min(...boxes.map(box => box.x)); y = Math.min(...boxes.map(box => box.y))
          right = Math.max(...boxes.map(box => box.x + box.width)); bottom = Math.max(...boxes.map(box => box.y + box.height))
        }
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
        clip = { x: Math.max(0, x), y: Math.max(0, y), width: Math.min(right, viewport.width) - Math.max(0, x), height: Math.min(bottom, viewport.height) - Math.max(0, y) }
      }
      await page.screenshot({ path: resolve(output, file), animations: 'disabled', ...(clip ? { clip } : {}) })
      const bytes = readFileSync(resolve(output, file))
      const dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
      manifest.push({ file, kind: 'Actual packaged application screenshot', demoData: true, region, dimensions, clip: clip || null })
      saveManifest()
      console.log(`Captured ${language}/${file}: ${dimensions.width}x${dimensions.height}`)
      await size()
    }
    const firstName = fixture.names[0]
    await button('Review {name}', { name: firstName }).waitFor()
    await capture('01-jobs.png')
    await library()
    await capture('02-library.png', [page.locator('.view-head'), page.locator('table:visible')], 'Library and candidate controls')
    await jobs()
    await button('Edit job').click()
    await capture('03-job-editor.png', [page.locator('.recruit-job-editor > .recruit-section-head'), page.locator('.recruit-job-editor .recruit-editor-columns')], 'Structured posting fields')
    await capture('04-criteria.png', [page.locator('.recruit-job-editor fieldset > .recruit-section-head'), page.locator('.recruit-editor-footer')], 'Evaluation criteria editor')
    await button('Cancel').click()
    await button('Filters').click()
    await page.getByRole('textbox', { name: t('Location'), exact: true }).fill(fixture.location)
    await capture('05-filters.png', [page.locator('.recruit-results-toolbar'), page.locator('#recruit-profile-filters'), page.locator('.recruit-candidate-table')], 'Candidate filters and resulting shortlist')
    await button('Clear filters').click()
    await button('Filters').click()
    await page.getByRole('button', { name: firstName, exact: true }).click()
    const detail = page.getByRole('dialog', { name: t('Details for {name}', { name: firstName }), exact: true })
    await detail.getByRole('button', { name: t('Edit profile'), exact: true }).waitFor()
    await capture('08-profile.png', [detail.locator('.recruiter-profile > .recruiter-section-head'), detail.locator('.recruiter-note')], 'Confirmed candidate details and reusable screening notes')
    const score = detail.locator('section').filter({ has: page.getByRole('heading', { name: t('Score breakdown'), exact: true }) })
    await capture('06-evidence.png', [score, detail.locator('blockquote.evidence').first()], 'Local score breakdown and original matching passage')
    await detail.getByRole('button', { name: t('Close'), exact: true }).click()
    await button('Review {name}', { name: firstName }).click()
    await page.locator('.recruit-criterion-review').first().waitFor()
    await page.waitForTimeout(1000)
    await capture('07-review.png', [page.locator('.recruit-review > .recruit-section-head'), page.locator('.recruit-criterion-review').first()], 'Job-specific review and one complete criterion assessment')
    await button('Close review').click()
    await page.getByRole('checkbox', { name: t('Compare {name}', { name: firstName }), exact: true }).check()
    await page.getByRole('checkbox', { name: t('Compare {name}', { name: fixture.names[1] }), exact: true }).check()
    await button('Compare candidates').click()
    await page.locator('.recruit-comparison').waitFor()
    const comparison = page.locator('.recruit-comparison')
    await capture('09-comparison.png', [comparison.locator('thead'), comparison.locator('tbody > tr').nth(5)], 'Comparison of recruiter-confirmed details')
    await capture('09-comparison-header.png', comparison.locator('thead'), 'Compared candidates and local match scores')
    await capture('09-comparison-criteria.png', comparison.locator('tbody > tr').nth(6), 'Complete required criterion with evidence for both candidates')
    await page.getByRole('button', { name: `${t('Shortlist')} ${t('{count}', { count: 2 })}`, exact: true }).click()
    await capture('10-shortlist.png', [page.locator('.recruit-tabs'), page.locator('.recruit-candidate-table')], 'Ordered shortlist with PDF and CSV export controls')
    await button('Express search').click()
    await page.getByRole('textbox', { name: t('Job description'), exact: true }).fill(fixture.posting.jobDescription)
    await page.getByRole('textbox', { name: t('Requirements'), exact: true }).fill(fixture.posting.requirements)
    await capture('13-express-form.png', page.locator('.recruit-express-editor'), 'Unsaved Express search input')
    await button('Find matches').click()
    await button('Save as job').waitFor()
    await capture('13-express-results.png', [page.locator('.recruit-workspace-head'), page.locator('.recruit-candidate-table tbody > tr').nth(2)], 'Temporary search results and explicit save/discard controls')
    await button('Discard search').click()
    await page.getByRole('heading', { name: fixture.posting.position, exact: true }).waitFor()
    for (const status of ['on-hold', 'open']) {
      await button('Change status').click()
      const dialog = page.getByRole('dialog', { name: t('Change status'), exact: true })
      await dialog.getByRole('combobox', { name: t('Job status'), exact: true }).selectOption(status)
      await dialog.getByRole('button', { name: t('Save status'), exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
    }
    await page.locator('.recruit-status-history summary').click()
    await capture('16-status.png', page.locator('.recruit-job-status-panel'), 'Recorded creation and status changes with timestamps')
    await page.evaluate(async ({ jobId, names }) => {
      const workspace = await window.api.recruiting.getJob(jobId)
      const resumes = await window.api.resumes.list()
      const selected = names.map(name => resumes.find(resume => resume.name === name))
      await window.api.recruiting.changeJobStatus({ jobId, expectedUpdatedAt: workspace.job.updatedAt, status: 'filled', placement: { hired: selected[0], backup2: selected[1], backup3: selected[2] } })
    }, fixture)
    await page.reload()
    await page.locator('.recruit-hiring-cards').waitFor()
    await capture('17-hiring.png', page.locator('.recruit-job-status-panel'), 'Filled role with hired candidate and ordered backups #2 and #3')

    const updated = await page.evaluate(async ({ name, arabic }) => {
      const text = arabic
        ? `${name}\nlina.hassan@example.com\nالموقع: الرياض، السعودية\n\nWORK EXPERIENCE\nقائدة التعلم الإقليمي، من 2025 إلى الوقت الحاضر. وسعت نطاق تدريب المطاعم إلى ٢٤ فرعًا. أطلقت برنامج تهيئة بالعربية والإنجليزية لعدد ٦٠٠ موظف. بنت لوحة فصلية لنتائج التعلم ودرجات تدقيق الخدمة. دربت المديرين الإقليميين على ملاحظة أثر التدريب.\n\nEDUCATION\nبكالوريوس إدارة الأعمال.\n\nSKILLS\nالتدريب والتطوير، سلامة الغذاء، القيادة، تهيئة الموظفين`
        : `${name}\nlina.hassan@example.com\nRiyadh, Saudi Arabia\n\nWORK EXPERIENCE\nRegional Learning Lead, 2025 to present. Expanded training across 24 restaurant sites. Introduced an Arabic and English onboarding programme for 600 employees. Built a quarterly dashboard of learning outcomes and service audit scores. Coached regional managers on training observations.\n\nEDUCATION\nBachelor of Business Administration.\n\nSKILLS\nTraining and Development, Food Safety, Leadership, Onboarding`
      const result = await window.api.ingest.text(text, arabic ? `${name}: سيرة ذاتية محدثة` : `${name} - Updated CV`)
      if (result.status !== 'imported' && result.status !== 'near-duplicate') throw new Error('Could not import updated fictional CV')
      return result.resume
    }, { name: firstName, arabic: language === 'ar' })
    await page.reload()
    await library()
    await page.getByRole('row').filter({ hasText: updated.fileName }).click()
    const history = page.getByRole('dialog', { name: t('Details for {name}', { name: firstName }), exact: true })
    await history.getByRole('button', { name: t('Link another CV'), exact: true }).click()
    const select = history.getByRole('combobox', { name: t('Resume to link'), exact: true })
    const choices = await select.locator('option').allTextContents()
    await select.selectOption({ label: choices.find(label => label.includes(firstName)) })
    await history.getByRole('button', { name: t('Link as same person'), exact: true }).click()
    await history.getByText(t('Resume versions linked to the same candidate.'), { exact: true }).waitFor()
    await capture('11-versions.png', history.locator('.resume-versions'), 'Linked original and updated CV versions')
    await history.getByRole('button', { name: t('Close'), exact: true }).click()
    await jobs()
    await capture('12-refresh-action.png', page.locator('.recruit-workspace-head'), 'Job header and Refresh matches action')
    await capture('12-refresh.png', page.locator('.recruit-notice').first(), 'Refresh prompt after a library change')
    await button('Refresh matches').click()
    await page.locator('.recruit-notice').waitFor({ state: 'hidden' })
    await button('Settings').click()
    await top()
    await capture('14-settings.png', [page.locator('.view-head'), page.locator('section[aria-labelledby="matching-heading"]')], 'Language, appearance and local matching settings')
    await capture('14-watched-folder.png', page.locator('section[aria-labelledby="watched-folder-heading"]'), 'Watched-folder setup')
    await capture('14-backups.png', page.locator('section[aria-labelledby="data-heading"]'), 'Portable backup and local data controls')
    await capture('15-creator.png', page.locator('.settings-creator'), 'Creator attribution and LinkedIn link')
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => true
      safeStorage.encryptString = key => { if (key !== 'sk-guide-synthetic-placeholder') throw new Error('Unexpected guide credential'); return Buffer.from('opaque-guide-only') }
    })
    await page.evaluate(async () => {
      await window.api.settings.setRerankConfig({ provider: 'openai', model: 'gpt-5.6' })
      await window.api.settings.setApiKey('sk-guide-synthetic-placeholder', 'openai')
      await window.api.settings.setRerank(true)
    })
    await button('Jobs').click()
    await button('Settings').click()
    await expect(page.getByRole('combobox', { name: t('AI model'), exact: true })).toHaveValue('gpt-5.6')
    await capture('18-ai-settings.png', page.locator('section[aria-labelledby="rerank-heading"]'), 'AI provider, model, protected key and enable controls')
    await jobs()
    await button('Rerank with {model}', { model: 'GPT-5.6' }).click()
    const review = page.getByRole('dialog', { name: t('Review data sent to {provider}', { provider: 'OpenAI' }), exact: true })
    await review.waitFor()
    await expect(review.locator('.consent-payload')).toBeHidden()
    await capture('19-ai-review.png', review, 'Concise data review with optional exported-data disclosure')
    await review.getByRole('button', { name: t('Cancel'), exact: true }).click()
    for (const obsolete of ['13-match.png', '13-claude-off.png']) rmSync(resolve(output, obsolete), { force: true })
    saveManifest()
    console.log(`Finished ${manifest.length} current ${language} screenshots; zero outbound requests.`)
  } finally {
    await app?.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

module.exports = { captureGuide }

const seedEnglish = async () => {
      const people = [
        { name: 'Lina Hassan', location: 'Riyadh', years: 9, skills: 'Training and Development, Onboarding, Food Safety, Leadership, Customer Service', work: 'Training Manager, Cedar Table Restaurants, 2020 to present. Led training across 18 restaurant sites in Riyadh. Designed onboarding for 420 employees and assessed training outcomes through manager observations and guest feedback. Delivered training in Arabic and English. Developed food safety workshops and coached 35 shift managers. Reduced onboarding completion time from six weeks to four weeks.' },
        { name: 'Omar Faris', location: 'Riyadh', years: 11, skills: 'Training and Development, Leadership, Food Safety, Operations Management, Customer Service', work: 'Regional Operations Trainer, Saffron Grove Hospitality, 2018 to present. Led training across 12 restaurant sites. Designed onboarding plans for new restaurant managers and assessed training outcomes using service audits. Delivered workshops in English and coached supervisors on food safety and customer service. Coordinated quarterly training calendars and tracked completion for 300 colleagues.' },
        { name: 'Maya Nasser', location: 'Jeddah', years: 7, skills: 'Training and Development, Onboarding, Leadership, Customer Service', work: 'Learning and Development Specialist, Harbour Learning Group, 2019 to present. Designed onboarding courses and leadership programmes for retail service teams. Assessed training outcomes using pre-course and post-course evaluations. Delivered training in Arabic and English. Managed learning management system content and facilitated monthly workshops for 150 staff.' },
        { name: 'Daniel Reed', location: 'Riyadh', years: 8, skills: 'Operations Management, Food Safety, Customer Service, Leadership', work: 'Restaurant General Manager, Olive Lane Kitchens, 2018 to present. Managed a busy restaurant with 45 staff. Trained new starters on food safety and guest service. Led scheduling, inventory and daily service reviews. Mentored four supervisors and supported a new branch opening. No regional learning programme ownership stated.' },
        { name: 'Sara Mansour', location: 'Dammam', years: 6, skills: 'Excel, Accounting, Financial Reporting, Budgeting', work: 'Senior Accountant, Horizon Supply Services, 2020 to present. Prepared monthly financial reporting, reconciled supplier balances and built annual budgets. Trained two junior accountants on month-end controls. Produced Excel dashboards for department spending and worked with external auditors.' },
        { name: 'Nadia Salem', location: 'Riyadh', years: 5, skills: 'Onboarding, Training and Development, Customer Service', work: 'HR and Training Coordinator, Juniper Cafe Group, 2021 to present. Scheduled induction sessions for four cafes. Maintained onboarding records, coordinated customer service training and gathered participant feedback. Supported recruitment administration and prepared monthly completion reports. Presented induction sessions in Arabic and English.' }
      ]
      for (const p of people) {
        const text = `${p.name}\n${p.name.toLowerCase().replace(' ', '.')}@example.com\n${p.location}, Saudi Arabia\n\nPROFESSIONAL SUMMARY\n${p.years} years of professional experience.\n\nWORK EXPERIENCE\n${p.work}\n\nEDUCATION\nBachelor of Business Administration, 2016.\n\nSKILLS\n${p.skills}`
        const result = await window.api.ingest.text(text, `${p.name} - CV`)
        if (result.status !== 'imported') throw new Error(`Demo import failed: ${p.name}: ${result.status}`)
      }
      const posting = { position: 'Training & Development Manager', jobDescription: 'Lead learning and development for a growing food and beverage group in Riyadh. Build consistent onboarding, coach restaurant managers and improve guest service across multiple branches.', requirements: 'Led training across multiple restaurant sites\nDesigned onboarding and assessed training outcomes\nDelivered training in Arabic and English', educationAndCertifications: 'Relevant degree or equivalent professional experience. Train-the-trainer certification is a plus.' }
      const criteria = [{ id: 'multi-site', text: 'Led training across multiple restaurant sites', importance: 'required' }, { id: 'outcomes', text: 'Designed onboarding and assessed training outcomes', importance: 'required' }, { id: 'languages', text: 'Delivered training in Arabic and English', importance: 'preferred' }]
      const job = await window.api.recruiting.saveJob({ posting, status: 'open', criteria })
      const resumes = await window.api.resumes.list()
      const profiles = [
        { name: 'Lina Hassan', salary: 'SAR 18,000 / month', notice: '30 days', availability: 'Available from October', tags: ['F&B', 'Multi-site training'], note: 'Screening call: confirmed 18-site scope. Ask for a sample onboarding plan.' },
        { name: 'Omar Faris', salary: 'SAR 20,000 / month', notice: '60 days', availability: 'Available from November', tags: ['F&B', 'Manager coaching'], note: 'Strong operations background. Confirm Arabic facilitation experience.' },
        { name: 'Maya Nasser', salary: 'SAR 16,000 / month', notice: '30 days', availability: 'Available from October', tags: ['Bilingual', 'Learning design'], note: 'Open to relocation to Riyadh. Explore direct restaurant training experience.' }
      ]
      for (const p of profiles) {
        const resume = resumes.find(r => r.name === p.name)
        if (!resume) throw new Error(`Missing parsed name: ${p.name}`)
        const source = people.find(person => person.name === p.name)
        await window.api.recruiting.saveProfile({ resume, name: p.name, email: resume.email, phone: null, location: source.location, yearsExperience: source.years, educationLevel: 'bachelors', skills: null, expectedSalary: p.salary, noticePeriod: p.notice, availability: p.availability, preferredLocation: 'Riyadh', tags: p.tags, note: p.note })
      }
      const workspace = await window.api.recruiting.searchJob(job.id)
      for (const [i, p] of profiles.entries()) {
        const match = workspace.response.results.find(m => m.resume.name === p.name)
        await window.api.recruiting.saveReview({ jobId: job.id, resume: match.resume, status: i === 2 ? 'maybe' : 'shortlisted', order: (i + 1) * 1024,
          note: i === 0 ? 'Strong evidence of multi-site restaurant training. Invite to screening; confirm notice period and training impact measures.' : i === 1 ? 'Strong manager coaching and service audit experience. Confirm bilingual delivery before interview.' : 'Good learning design background. Clarify direct restaurant experience and relocation timing.',
          assessments: criteria.map((criterion, n) => ({ criterionId: criterion.id, status: i === 0 ? (n === 1 ? 'needs-clarification' : 'evidence-found') : (n === 2 ? 'needs-clarification' : 'evidence-found'), note: i === 0 && n === 0 ? 'CV states 18 restaurant sites and 420 employees.' : i === 0 && n === 1 ? 'Ask how training impact was measured after launch.' : i === 1 && n === 2 ? 'Ask for examples of Arabic facilitation.' : '' })) })
      }
      await window.api.settings.setTheme('light')
      return { jobId: job.id, posting, criteria, names: ['Lina Hassan', 'Omar Faris', 'Maya Nasser'], location: 'Riyadh' }
    }

if (require.main === module) captureGuide({ language: 'en', seed: seedEnglish }).catch(error => { console.error(error); process.exitCode = 1 })
