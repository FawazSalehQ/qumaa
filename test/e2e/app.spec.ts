import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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
  // Production deletion is guarded by an OS-native confirmation. Stub only
  // this test process's next dialog so the automated flow can accept it.
  await application.evaluate(({ dialog }) => {
    ;(dialog as any).showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
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
    hasRerankPreview: typeof (window as any).api?.search?.previewRerank === 'function',
    hasBackup: typeof (window as any).api?.settings?.backup === 'function',
    hasRestore: typeof (window as any).api?.settings?.restore === 'function',
    hasRequire: typeof (window as any).require,
    hasProcess: typeof (window as any).process,
    isolated: (window as any).process?.contextIsolated
  }))

  expect(boundary).toEqual({
    hasNamedApi: true,
    hasRerankPreview: true,
    hasBackup: true,
    hasRestore: true,
    hasRequire: 'undefined',
    hasProcess: 'undefined',
    isolated: undefined
  })

  const invalidInput = await page.evaluate(async () => {
    try {
      await (window as any).api.resumes.get(-1)
      return 'accepted'
    } catch (error) {
      return String(error)
    }
  })
  expect(invalidInput).toContain('Invalid resume reference')

  const arbitraryPath = await page.evaluate(async () => {
    try {
      await (window as any).api.ingest.files(['/tmp/private.md'])
      return 'accepted'
    } catch (error) {
      return String(error)
    }
  })
  expect(arbitraryPath).not.toBe('accepted')

  const forgedCollection = await page.evaluate(async () => {
    try {
      await (window as any).api.ingest.files({
        map: () => ['/tmp/private.md']
      })
      return 'accepted'
    } catch (error) {
      return String(error)
    }
  })
  expect(forgedCollection).not.toBe('accepted')

  // A production file:// renderer must not inherit broad read access to other
  // local files. Keep a sentinel outside the packaged renderer and verify CSP
  // plus Chromium's file-fetch policy reject it.
  const sentinelPath = resolve(scratch, 'renderer-private-sentinel.txt')
  writeFileSync(sentinelPath, 'QUMAA-PRIVATE-SENTINEL', { mode: 0o600 })
  const localFileRead = await page.evaluate(async (url) => {
    try {
      const response = await fetch(url)
      return { accepted: true, text: await response.text() }
    } catch {
      return { accepted: false, text: '' }
    }
  }, pathToFileURL(sentinelPath).href)
  expect(localFileRead).toEqual({ accepted: false, text: '' })

  let receivedFormPost = false
  const sink = createServer((_request, response) => {
    receivedFormPost = true
    response.end('unexpected')
  })
  await new Promise<void>((resolveListen) => sink.listen(0, '127.0.0.1', resolveListen))
  try {
    const { port } = sink.address() as AddressInfo
    await page.evaluate((url) => {
      const target = document.createElement('iframe')
      target.name = 'exfiltration-target'
      document.body.append(target)
      const form = document.createElement('form')
      form.action = url
      form.method = 'POST'
      form.target = target.name
      const field = document.createElement('input')
      field.name = 'resume'
      field.value = 'QUMAA-PRIVATE-SENTINEL'
      form.append(field)
      document.body.append(form)
      form.submit()
    }, `http://127.0.0.1:${port}/collect`)
    await page.waitForTimeout(150)
    expect(receivedFormPost).toBe(false)
  } finally {
    await new Promise<void>((resolveClose, rejectClose) =>
      sink.close((error) => (error ? rejectClose(error) : resolveClose()))
    )
  }

  // webRequest covers Fetch and other URL requests, but WebRTC can open its
  // own UDP channel to a STUN/TURN endpoint. A live sink provides an end-to-end
  // regression for that separate path. First prove the sink can receive, then
  // require Chromium's document policy to reject the constructor without
  // emitting even an initial STUN packet.
  let receivedWebRtcPackets = 0
  const udpSink = createSocket('udp4')
  udpSink.on('message', () => {
    receivedWebRtcPackets += 1
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    udpSink.once('error', rejectListen)
    udpSink.bind(0, '127.0.0.1', () => {
      udpSink.off('error', rejectListen)
      resolveListen()
    })
  })
  try {
    const { port } = udpSink.address()
    await new Promise<void>((resolveSend, rejectSend) => {
      udpSink.send(Buffer.from('sink-control'), port, '127.0.0.1', (error) =>
        error ? rejectSend(error) : resolveSend()
      )
    })
    await expect.poll(() => receivedWebRtcPackets).toBeGreaterThan(0)
    receivedWebRtcPackets = 0

    const webRtcAttempt = await page.evaluate(async (sinkPort) => {
      let peer: RTCPeerConnection | null = null
      try {
        peer = new RTCPeerConnection({
          iceServers: [{ urls: `stun:127.0.0.1:${sinkPort}` }],
          iceCandidatePoolSize: 1
        })
        peer.createDataChannel('exfiltration-probe')
        await peer.setLocalDescription(await peer.createOffer())
        await new Promise((resolveWait) => setTimeout(resolveWait, 1_800))
        return { constructed: true, errorName: '' }
      } catch (error) {
        return {
          constructed: false,
          errorName: error instanceof DOMException ? error.name : String(error)
        }
      } finally {
        peer?.close()
      }
    }, port)

    await page.waitForTimeout(250)
    expect(webRtcAttempt).toEqual({ constructed: false, errorName: 'NotAllowedError' })
    expect(receivedWebRtcPackets).toBe(0)
  } finally {
    await new Promise<void>((resolveClose) => udpSink.close(() => resolveClose()))
  }
})

test('shows the exact redacted Claude request in a keyboard-contained consent dialog', async () => {
  await page.evaluate(async () => {
    await window.api.ingest.text(
      `Private Candidate One\none@example.com\n+966 50 111 2233\n\nWORK EXPERIENCE\nSenior engineer from 2019 to 2025. Led a TypeScript platform migration, coached developers, and operated reliable cloud services.\n\nSKILLS\nTypeScript, AWS`,
      'Private Candidate One'
    )
    await window.api.ingest.text(
      `Private Candidate Two\ntwo@example.com\n+966 50 222 3344\n\nWORK EXPERIENCE\nSoftware engineer from 2020 to 2025. Built TypeScript APIs, improved service reliability, and supported production systems.\n\nSKILLS\nTypeScript, Node.js`,
      'Private Candidate Two'
    )
    await window.api.settings.setApiKey('sk-ant-api03-e2e-placeholder')
    await window.api.settings.setRerank(true)
  })
  // The imports above intentionally bypass the renderer controls; reload so
  // App takes a fresh library/settings snapshot before exercising the dialog.
  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  await page.getByRole('button', { name: 'Match', exact: true }).click()

  await page.getByLabel('Position').fill('Senior TypeScript engineer')
  await page.getByLabel('Job Description').fill('Lead a reliable TypeScript platform migration.')
  await page.getByLabel('Requirements').fill('TypeScript\nCloud services\nTeam leadership')
  await page.getByRole('button', { name: 'Find matches' }).click()
  const rerank = page.getByRole('button', { name: 'Rerank with Claude' })
  await expect(rerank).toBeVisible()
  await rerank.click()

  const dialog = page.getByRole('dialog', { name: 'Review data sent to Anthropic' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Exact outbound request' })).toBeVisible()
  const payload = await dialog.locator('.consent-payload').innerText()
  expect(payload).toContain('candidate-01')
  expect(payload).not.toContain('Private Candidate')
  expect(payload).not.toContain('one@example.com')
  expect(payload).not.toContain('+966 50 111 2233')

  const cancel = dialog.getByRole('button', { name: 'Cancel' })
  const approve = dialog.getByRole('button', { name: 'Approve and send' })
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(approve).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(rerank).toBeFocused()
})

test('allows only one process to own a Qumaa data directory', async () => {
  const primary = application.process()
  const second = spawn(primary.spawnfile, primary.spawnargs.slice(1), {
    cwd: ROOT,
    env: {
      ...process.env,
      QUMAA_E2E_USER_DATA: scratch,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    stdio: 'ignore'
  })
  const [code, signal] = (await once(second, 'exit')) as [number | null, NodeJS.Signals | null]
  expect(signal).toBeNull()
  expect(code).toBe(0)
  expect(application.windows()).toHaveLength(1)
})

test('opens the creator LinkedIn profile through the fixed browser action', async () => {
  await application.evaluate(({ shell }) => {
    ;(shell as any).openExternal = async (url: string) => { (globalThis as any).openedCreatorUrl = url }
  })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByText('Fawaz Aljathnan', { exact: true })).toBeVisible()
  const linkedin = page.getByRole('link', { name: 'View Fawaz Aljathnan on LinkedIn (opens in your browser)' })
  await expect(linkedin).toHaveAttribute('href', 'https://linkedin.com/fawazsalehq')
  await linkedin.click()
  await expect.poll(() => application.evaluate(() => (globalThis as any).openedCreatorUrl))
    .toBe('https://linkedin.com/fawazsalehq')
})

test('keeps recruiter corrections separate and links CV versions without losing notes', async () => {
  const versions = await page.evaluate(async () => {
    const base = 'Jordan Avery\njordan.avery@example.com\n\nWORK EXPERIENCE\nSenior software engineer, 2019 to 2025. Built reliable TypeScript services, led platform migrations, and coached a team of eight engineers.\n\nSKILLS\nTypeScript, AWS, PostgreSQL'
    const outcomes = [
      await window.api.ingest.text(base, 'Jordan original'),
      await window.api.ingest.text(base + '\nLed an additional accessibility project in 2026.', 'Jordan updated')
    ]
    return outcomes.map((outcome) => {
      if (outcome.status !== 'imported' && outcome.status !== 'near-duplicate') throw new Error('Could not create CV fixtures')
      return outcome.resume.recordKey
    })
  })
  await page.reload()
  await page.getByRole('button', { name: /Library/ }).click()
  await page.getByRole('row').filter({ hasText: 'Jordan original' }).click()
  const detail = page.getByRole('dialog', { name: 'Details for Jordan Avery' })
  await detail.getByRole('button', { name: 'Add details' }).click()
  await detail.getByLabel('Name', { exact: true }).fill('Jordan A. Avery')
  await detail.getByLabel('Expected salary', { exact: true }).fill('SAR 18,000 / month')
  await detail.getByLabel('Availability', { exact: true }).fill('Available from October')
  await detail.getByLabel('Tags', { exact: true }).fill('Platform, Talent pool')
  await detail.getByLabel('Screening notes', { exact: true }).fill('Confirmed availability during screening.')
  await detail.getByRole('button', { name: 'Save profile', exact: true }).click()
  await expect(detail.getByText('Recruiter profile saved.', { exact: true })).toBeVisible()
  await detail.getByRole('button', { name: 'Link another CV' }).click()
  await detail.getByLabel('Resume to link', { exact: true }).selectOption(versions[1])
  await detail.getByRole('button', { name: 'Link as same person' }).click()
  await expect(detail.getByText('Resume versions linked to the same candidate.')).toBeVisible()
  await expect.poll(() => page.evaluate(async () => (await window.api.recruiting.listProfiles())[0].recordKeys.length)).toBe(2)
  await detail.getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: /Library/ }).click()
  await page.getByRole('textbox', { name: 'Search candidates and screening information' }).fill('Available from October')
  await expect(page.getByRole('row').filter({ hasText: 'Jordan A. Avery' })).toHaveCount(2)
  const saved = await page.evaluate(async () => {
    const profile = (await window.api.recruiting.listProfiles())[0]
    const originals = await window.api.resumes.list()
    return { profile, names: originals.map((resume) => resume.name) }
  })
  expect(saved.profile.note).toBe('Confirmed availability during screening.')
  expect(saved.names).toEqual(['Jordan Avery', 'Jordan Avery'])
})

test('saves a job, reviews and compares candidates, rediscovers CVs, and exports the ordered shortlist', async () => {
  await page.evaluate(async () => {
    await window.api.ingest.text('Alex Morgan\nalex@example.com\n\nWORK EXPERIENCE\nSoftware engineer, 2018 to 2025. Led TypeScript platform development and mentored engineers. Operated AWS services and PostgreSQL databases.\n\nSKILLS\nTypeScript, AWS, PostgreSQL', 'Alex Morgan')
    await window.api.ingest.text('Sam Parker\nsam@example.com\n\nWORK EXPERIENCE\nSoftware engineer, 2020 to 2025. Developed TypeScript APIs and reliable cloud systems, maintained automated testing, and coached junior developers.\n\nSKILLS\nTypeScript, Node.js, AWS', 'Sam Parker')
  })
  await page.reload()
  await page.getByRole('button', { name: '+ New job', exact: true }).click()
  await page.getByLabel('Position', { exact: true }).fill('Platform Engineer')
  await page.getByLabel('Job description', { exact: true }).fill('Develop TypeScript services and support a reliable cloud platform.')
  await page.getByLabel('Requirements', { exact: true }).fill('TypeScript\nAWS')
  await page.getByRole('button', { name: 'Use requirement lines' }).click()
  await page.getByLabel('Importance of criterion 2').selectOption('preferred')
  // Navigation keeps the job editor and later an unsaved review mounted.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(page.getByLabel('Position', { exact: true })).toHaveValue('Platform Engineer')
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await page.getByRole('button', { name: 'Find matches', exact: true }).click()
  await page.getByRole('button', { name: 'Review Alex Morgan', exact: true }).click()
  await page.getByRole('combobox', { name: 'Review state', exact: true }).selectOption('shortlisted')
  await page.getByRole('textbox', { name: 'Screening notes / recommendation', exact: true }).fill('Strong platform experience; discuss team leadership.')
  await page.getByLabel('Assessment: TypeScript', { exact: true }).selectOption('confirmed')
  await page.getByLabel('Evidence note: TypeScript', { exact: true }).fill('Confirmed during the technical screen.')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Screening notes / recommendation', exact: true })).toHaveValue('Strong platform experience; discuss team leadership.')
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Review saved on this device', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close review', exact: true }).click()
  await page.getByRole('button', { name: 'Shortlist Sam Parker', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove Sam Parker from shortlist' })).toBeEnabled()
  await page.getByRole('checkbox', { name: 'Compare Alex Morgan', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Compare Sam Parker', exact: true }).check()
  await page.getByRole('button', { name: 'Compare candidates', exact: true }).click()
  const comparison = page.getByLabel('Candidate comparison table', { exact: true })
  await expect(comparison.getByText('Confirmed during the technical screen.', { exact: true })).toBeVisible()
  await expect(comparison.getByText('Suggested passage · experience', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Shortlist 2', exact: true }).click()
  await page.getByRole('button', { name: 'Move Sam Parker up', exact: true }).click()
  await expect(page.locator('.recruit-candidate-table tbody tr').first()).toContainText('Sam Parker')

  const csvPath = resolve(scratch, 'selected.csv')
  await application.evaluate(({ dialog }, filePath) => {
    ;(dialog as any).showSaveDialog = async () => ({ canceled: false, filePath })
  }, csvPath)
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  await expect.poll(() => existsSync(csvPath)).toBe(true)
  const csv = readFileSync(csvPath, 'utf8')
  expect(csv).toContain('Strong platform experience; discuss team leadership.')
  expect(csv.indexOf('Sam Parker')).toBeLessThan(csv.indexOf('Alex Morgan'))
  const pdfPath = resolve(scratch, 'selected.pdf')
  await application.evaluate(({ dialog }, filePath) => {
    ;(dialog as any).showSaveDialog = async () => ({ canceled: false, filePath })
  }, pdfPath)
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  await expect.poll(() => existsSync(pdfPath)).toBe(true)
  expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-')

  await page.evaluate(async () => {
    await window.api.ingest.text('Casey Taylor\ncasey@example.com\n\nWORK EXPERIENCE\nBackend developer, 2021 to 2025. Built Node.js and TypeScript APIs for cloud applications.\n\nSKILLS\nTypeScript, Node.js', 'Casey Taylor')
  })
  await page.reload()
  await expect(page.getByText('1 new CV to match', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Shortlist 2', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Refresh matches', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeEnabled()
  await expect(page.locator('.recruit-candidate-table tbody tr').first()).toContainText('Sam Parker')
  await page.getByRole('button', { name: 'Review Alex Morgan', exact: true }).click()
  await expect(page.getByLabel('Assessment: TypeScript', { exact: true })).toHaveValue('confirmed')
  await expect(page.getByRole('textbox', { name: 'Screening notes / recommendation', exact: true })).toHaveValue('Strong platform experience; discuss team leadership.')
  const persisted = await page.evaluate(async () => {
    const job = (await window.api.recruiting.listJobs())[0]
    return window.api.recruiting.getJob(job.id)
  })
  expect(persisted.job.criteria.map((criterion) => criterion.importance)).toEqual(['required', 'preferred'])
  expect(persisted.response?.results).toHaveLength(3)
})

test('deleting all data also clears a job draft retained across navigation', async () => {
  await page.getByRole('button', { name: '+ New job', exact: true }).click()
  await page.getByLabel('Position', { exact: true }).fill('Private unsaved vacancy')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await application.evaluate(({ dialog }) => {
    ;(dialog as any).showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  await page.getByRole('button', { name: 'Delete all data…', exact: true }).click()
  await expect(page.getByText('All data deleted.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Create your first job', exact: true })).toBeVisible()
  await expect(page.getByLabel('Position', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toEqual([])
})

test('a fixed theme stays fixed while system theme changes', async () => {
  const appliedTheme = (): Promise<string | undefined> =>
    page.evaluate(() => document.documentElement.dataset.theme)

  await page.emulateMedia({ colorScheme: 'light' })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Back up…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore…' })).toBeVisible()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect.poll(appliedTheme).toBe('dark')

  // A former second theme hook left a stale "system" listener mounted in App,
  // so this OS light/dark cycle could overwrite the fixed Dark selection.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(appliedTheme).toBe('dark')

  await page.getByRole('button', { name: 'System', exact: true }).click()
  await expect.poll(appliedTheme).toBe('light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(appliedTheme).toBe('dark')
})
