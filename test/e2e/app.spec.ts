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
import { translate } from '../../src/shared/i18n.js'

const ROOT = resolve(__dirname, '../..')

let application: ElectronApplication
let page: Page
let scratch: string

async function launchApplication(): Promise<void> {
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
}

test.beforeEach(async () => {
  scratch = mkdtempSync(resolve(tmpdir(), 'qumaa-ui-'))
  await launchApplication()
})

test.afterEach(async () => {
  await application?.close()
  rmSync(scratch, { recursive: true, force: true })
})

async function prepareClaudeFixtures(): Promise<void> {
  // Keep this synthetic fixture independent of host Keychain and deny all
  // network access. A local provider response is installed only after testing
  // that dismissing the consent dialog leaves the saved local order intact.
  await application.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => true
    safeStorage.encryptString = (value: string) => {
      if (value !== 'sk-ant-api03-e2e-placeholder') throw new Error('Unexpected consent-test credential')
      return Buffer.from('opaque-consent-ui-fixture')
    }
    safeStorage.decryptString = () => { throw new Error('The consent UI test must never send a request') }
    globalThis.fetch = async () => { throw new Error('Unexpected network request before consent') }
  })
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
}

async function installClaudeProvider(deferred = false): Promise<void> {
  await application.evaluate(({ safeStorage, dialog }, deferred) => {
    safeStorage.decryptString = () => 'sk-ant-api03-e2e-placeholder'
    ;(globalThis as any).approvedRequests = []
    ;(globalThis as any).nativeConfirmations = []
    ;(dialog as any).showMessageBox = async (_window: unknown, options: unknown) => {
      ;(globalThis as any).nativeConfirmations.push(options)
      return { response: 1, checkboxChecked: false }
    }
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url !== 'https://api.anthropic.com/v1/messages' || init?.method !== 'POST') {
        throw new Error('Unexpected consent-test endpoint')
      }
      const body = JSON.parse(String(init.body))
      ;(globalThis as any).approvedRequests.push(body)
      if (deferred) await new Promise<void>((resolveResponse) => { (globalThis as any).releaseProviderResponse = resolveResponse })
      return new Response(JSON.stringify({
        id: 'msg_qumaa_e2e',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: JSON.stringify({ ranking: [
          { id: 'candidate-02', rank: 1, reason: 'Supported production systems and improved reliable TypeScript services.' },
          { id: 'candidate-01', rank: 2, reason: 'Built TypeScript services and coached developers.' }
        ] }) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  }, deferred)
}

async function installOpenAIProvider(): Promise<void> {
  await application.evaluate(({ safeStorage, dialog }) => {
    safeStorage.isEncryptionAvailable = () => true
    safeStorage.encryptString = (value: string) => {
      if (value === 'sk-openai-e2e-placeholder') return Buffer.from('opaque-openai-ui-fixture')
      if (value === 'sk-ant-api03-e2e-placeholder') return Buffer.from('opaque-consent-ui-fixture')
      throw new Error('Unexpected provider-test credential')
    }
    safeStorage.decryptString = (value: Buffer) => {
      if (value.toString() === 'opaque-openai-ui-fixture') return 'sk-openai-e2e-placeholder'
      if (value.toString() === 'opaque-consent-ui-fixture') return 'sk-ant-api03-e2e-placeholder'
      throw new Error('Unexpected provider-test protected value')
    }
    ;(globalThis as any).approvedRequests = []
    ;(globalThis as any).nativeConfirmations = []
    ;(dialog as any).showMessageBox = async (_window: unknown, options: unknown) => {
      ;(globalThis as any).nativeConfirmations.push(options)
      return { response: 1, checkboxChecked: false }
    }
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url !== 'https://api.openai.com/v1/responses' || init?.method !== 'POST') throw new Error('Unexpected provider-test endpoint')
      const headers = new Headers(init.headers)
      if (headers.get('authorization') !== 'Bearer sk-openai-e2e-placeholder') throw new Error('The wrong provider credential was used')
      const body = JSON.parse(String(init.body))
      ;(globalThis as any).approvedRequests.push({ url, body })
      return new Response(JSON.stringify({
        id: 'resp_qumaa_e2e', object: 'response', status: 'completed', model: body.model,
        output: [{ id: 'msg_qumaa_e2e', type: 'message', role: 'assistant', status: 'completed', content: [{
          type: 'output_text', annotations: [], text: JSON.stringify({ ranking: [
            { id: 'candidate-02', rank: 1, reason: 'Supported production systems and improved reliable TypeScript services.' },
            { id: 'candidate-01', rank: 2, reason: 'Built TypeScript services and coached developers.' }
          ] })
        }] }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  })
}

test('imports, runs Express search across tabs, saves it deliberately, and removes deleted candidates', async ({}, testInfo) => {
  const navigation = page.getByRole('navigation')
  await expect(navigation.getByRole('button')).toHaveText(['Jobs', 'Companies', 'Recruiter desk', 'Library 0', 'Settings'])
  await expect(navigation.getByRole('button', { name: 'Jobs', exact: true })).toHaveAttribute('aria-current', 'page')
  const expressEntry = page.getByRole('button', { name: 'Express search', exact: true })
  const newJobEntry = page.getByRole('button', { name: '+ New job', exact: true })
  await expect(expressEntry).toBeVisible()
  await expect(newJobEntry).toBeVisible()
  const expressBounds = (await expressEntry.boundingBox())!
  const newJobBounds = (await newJobEntry.boundingBox())!
  expect(Math.abs(expressBounds.y - newJobBounds.y)).toBeLessThan(5)
  await page.screenshot({ path: testInfo.outputPath('express-entry-english.png'), fullPage: true, animations: 'disabled' })
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
  await page.getByRole('button', { name: 'Paste text' }).click()
  await page.getByPlaceholder('Label (e.g. candidate name)').fill('Jordan Lee')
  await page.getByPlaceholder('Paste the resume text here…').fill(`Jordan Lee
jordan.lee@example.com

WORK EXPERIENCE
Community Hospital - Registered Nurse
Jan 2020 - Dec 2025
Provided bedside care, administered medication, monitored vital signs, and maintained clinical patient records in a medical ward.

SKILLS
Nursing, patient care, medication administration, clinical documentation`)
  await page.getByRole('button', { name: 'Add to library' }).click()
  await expect(page.getByText('Jordan Lee', { exact: true }).first()).toBeVisible()
  const menuShortcuts = await application.evaluate(({ Menu, BrowserWindow }) => {
    const entries = Menu.getApplicationMenu()!.items.flatMap((item) => item.submenu?.items ?? [])
    const newJob = entries.find((item) => item.label === 'New Job')!
    newJob.click(newJob, BrowserWindow.getAllWindows()[0], {} as never)
    return entries.filter((item) => ['New Job', 'Jobs', 'Library', 'Settings'].includes(item.label) && item.accelerator)
      .map((item) => ({ label: item.label, accelerator: item.accelerator }))
  })
  expect(menuShortcuts).toEqual(expect.arrayContaining([
    { label: 'New Job', accelerator: 'CmdOrCtrl+N' },
    { label: 'Jobs', accelerator: 'CmdOrCtrl+1' },
    { label: 'Library', accelerator: 'CmdOrCtrl+2' },
    { label: 'Settings', accelerator: 'CmdOrCtrl+3' }
  ]))
  await expect(navigation.getByRole('button', { name: 'Jobs', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: 'Save job', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Position', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Find matches', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expressEntry.click()

  const originalPosting = {
    position: '',
    jobDescription: 'Restaurant Training Manager\nLead training and onboarding programs across a multi-branch restaurant group.',
    requirements: `Design onboarding and staff training programs
Coach restaurant teams across multiple branches
Maintain SOPs and food-safety standards`,
    educationAndCertifications: ''
  }

  await expect(page.getByRole('textbox')).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: 'Position', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Job status', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Education and certifications', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Use requirement lines', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Save job', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Find matches', exact: true })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Job description', exact: true }).fill(originalPosting.jobDescription)
  await page.getByLabel('Requirements').fill(originalPosting.requirements)
  await page.screenshot({ path: testInfo.outputPath('express-form-english.png'), fullPage: true, animations: 'disabled' })
  await navigation.getByRole('button', { name: 'Settings', exact: true }).click()
  await navigation.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Job description', exact: true })).toHaveValue(originalPosting.jobDescription)
  await expect(page.getByRole('textbox', { name: 'Requirements', exact: true })).toHaveValue(originalPosting.requirements)
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toEqual([])
  await page.getByRole('button', { name: 'Find matches' }).click()
  await expect(page.getByText('Express search', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Taylor Morgan', exact: true })).toBeVisible()
  await expect(page.locator('.recruit-candidate-table tbody .recruit-name')).toHaveText(['Taylor Morgan', 'Jordan Lee'])
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toEqual([])
  for (const destination of [/^Library/, /^Settings$/]) {
    await navigation.getByRole('button', { name: destination }).click()
    await navigation.getByRole('button', { name: 'Jobs', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Restaurant Training Manager', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Taylor Morgan', exact: true })).toBeVisible()
  }
  await page.screenshot({ path: testInfo.outputPath('express-results-english.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Taylor Morgan', exact: true }).click()
  const evidence = page.getByRole('dialog', { name: 'Details for Taylor Morgan', exact: true })
  await expect(evidence.getByRole('heading', { name: 'Matching passages', exact: true })).toBeVisible()
  await expect(evidence.locator('.evidence').first()).toBeVisible()
  await evidence.getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('button', { name: 'Edit search', exact: true }).click()
  await expect(page.getByRole('textbox')).toHaveCount(2)
  await page.getByRole('textbox', { name: 'Job description', exact: true }).fill('A different unsaved description')
  await page.getByLabel('Requirements').fill('Different unsaved requirements')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'Restaurant Training Manager', exact: true })).toBeVisible()
  await expect(page.getByText('A different unsaved description')).toHaveCount(0)

  await page.getByRole('button', { name: 'Edit search', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Job description', exact: true })).toHaveValue(originalPosting.jobDescription)
  await expect(page.getByLabel('Requirements')).toHaveValue(originalPosting.requirements)
  const revisedPosting = { ...originalPosting, jobDescription: 'Senior Restaurant Training Manager\nLead training and onboarding programs across a multi-branch restaurant group.' }
  await page.getByRole('textbox', { name: 'Job description', exact: true }).fill(revisedPosting.jobDescription)
  await page.getByRole('button', { name: 'Find matches', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Senior Restaurant Training Manager', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Taylor Morgan', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toEqual([])

  const quickPdf = resolve(scratch, 'temporary-top3.pdf')
  await application.evaluate(({ dialog }, filePath) => {
    ;(dialog as any).showSaveDialog = async () => ({ canceled: false, filePath })
  }, quickPdf)
  await page.getByRole('button', { name: 'Export top 3…', exact: true }).click()
  await expect.poll(() => existsSync(quickPdf)).toBe(true)
  expect(readFileSync(quickPdf).subarray(0, 5).toString('ascii')).toBe('%PDF-')
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toEqual([])

  await page.getByRole('button', { name: 'Save as job', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Review Taylor Morgan', exact: true })).toBeEnabled()
  const promotedJobs = await page.evaluate(() => window.api.recruiting.listJobs())
  expect(promotedJobs).toHaveLength(1)
  expect(promotedJobs[0].posting).toEqual(revisedPosting)

  await expressEntry.click()
  await page.getByRole('textbox', { name: 'Job description', exact: true }).fill('Disposable vacancy')
  await page.getByRole('button', { name: 'Find matches', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Disposable vacancy', exact: true })).toBeVisible()
  await page.getByRole('complementary', { name: 'Saved jobs', exact: true })
    .getByRole('button', { name: /Senior Restaurant Training Manager/ }).click()
  await expect(page.getByRole('heading', { name: 'Senior Restaurant Training Manager', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open express search', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Disposable vacancy', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Discard search', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open express search', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Senior Restaurant Training Manager', exact: true })).toBeVisible()
  expect((await page.evaluate(() => window.api.recruiting.listJobs())).map((job) => job.id)).toEqual([promotedJobs[0].id])

  await page.getByRole('button', { name: 'Taylor Morgan', exact: true }).click()
  // Production deletion is guarded by an OS-native confirmation. Stub only
  // this test process's next dialog so the automated flow can accept it.
  await application.evaluate(({ dialog }) => {
    ;(dialog as any).showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  await page.locator('.detail-foot').getByRole('button', { name: 'Delete' }).click()

  await expect(page.getByRole('heading', { name: 'Senior Restaurant Training Manager', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review Taylor Morgan', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^(Find|Refresh) matches$/ })).toBeEnabled()
  const saved = await page.evaluate(async () => {
    const [job] = await window.api.recruiting.listJobs()
    return window.api.recruiting.getJob(job.id)
  })
  expect(saved.job.posting).toEqual(revisedPosting)
  expect(saved.response?.results.map((result) => result.resume.name)).toEqual(['Jordan Lee'])
})

test('exposes the hardened renderer boundary', async () => {
  const boundary = await page.evaluate(() => ({
    hasNamedApi: typeof (window as any).api?.recruiting?.searchJob === 'function',
    hasRerankPreview: typeof (window as any).api?.recruiting?.previewRerank === 'function',
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

test('promotes an Express search with Claude without rerunning or losing its order and reasons', async () => {
  await prepareClaudeFixtures()
  await page.getByRole('button', { name: 'Express search', exact: true }).click()
  await page.getByRole('textbox', { name: 'Job description', exact: true }).fill('Temporary TypeScript search')
  await page.getByRole('textbox', { name: 'Requirements', exact: true }).fill('TypeScript\nCloud services')
  await page.getByRole('button', { name: 'Find matches', exact: true }).click()
  const names = page.locator('.recruit-candidate-table tbody .recruit-name')
  await expect(names).toHaveCount(2)
  const localNames = await names.allTextContents()
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toEqual([])
  await expect(page.getByRole('button', { name: 'Shortlist 0', exact: true })).toBeDisabled()

  await installClaudeProvider()
  await page.getByRole('button', { name: 'Rerank with Sonnet 5', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Review data sent to Anthropic', exact: true })
  await expect(dialog).toBeVisible()
  const dataToggle = dialog.locator('button[aria-controls]')
  await expect(dataToggle).toHaveAccessibleName('See exported data')
  await expect(dataToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog.locator('.consent-payload')).toBeHidden()
  await dataToggle.focus()
  await page.keyboard.press('Enter')
  await expect(dataToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(dataToggle).toHaveAccessibleName('Hide exported data')
  await expect(dialog.locator('.consent-payload')).toBeVisible()
  const approvedPayload = JSON.parse(await dialog.locator('.consent-payload').innerText())
  await page.keyboard.press('Space')
  await expect(dataToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog.locator('.consent-payload')).toBeHidden()
  expect(await application.evaluate(() => (globalThis as any).approvedRequests)).toEqual([])
  expect(await application.evaluate(() => (globalThis as any).nativeConfirmations)).toEqual([])
  await dialog.getByRole('button', { name: 'Approve and send', exact: true }).click()
  await expect(page.getByText('Reordered by Sonnet 5', { exact: true })).toBeVisible()
  await expect(names).toHaveText([...localNames].reverse())
  expect(await application.evaluate(() => (globalThis as any).approvedRequests)).toEqual([approvedPayload])
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toEqual([])

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(names).toHaveText([...localNames].reverse())

  // Hold the empty saved-jobs list from a library refresh while its independent
  // workspace read completes. Saving must take precedence over this old reply.
  await application.evaluate(({ ipcMain, BrowserWindow }) => {
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => Promise<unknown>>
    const listJobs = handlers.get('recruiting:listJobs')!
    const getJob = handlers.get('recruiting:getJob')!
    let holdNextList = true
    ;(globalThis as any).workspaceReadsFinished = 0
    handlers.set('recruiting:listJobs', async (...args) => {
      if (!holdNextList) return listJobs(...args)
      holdNextList = false
      const snapshot = await listJobs(...args)
      ;(globalThis as any).heldJobList = snapshot
      await new Promise<void>((release) => { (globalThis as any).releaseOldJobList = release })
      ;(globalThis as any).oldJobListReturned = true
      return snapshot
    })
    handlers.set('recruiting:getJob', async (...args) => {
      const result = await getJob(...args)
      ;(globalThis as any).workspaceReadsFinished += 1
      return result
    })
    BrowserWindow.getAllWindows()[0].webContents.send('ev:ingestProgress', {
      jobId: 'duplicate-before-promotion', processed: 1, total: 1, currentFile: '', done: true
    })
  })
  await expect.poll(() => application.evaluate(() => (globalThis as any).heldJobList)).toEqual([])
  await expect.poll(() => application.evaluate(() => (globalThis as any).workspaceReadsFinished)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Save as job', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit job', exact: true })).toBeEnabled()
  await expect(names).toHaveText([...localNames].reverse())
  await application.evaluate(() => { (globalThis as any).releaseOldJobList() })
  await expect.poll(() => application.evaluate(() => (globalThis as any).oldJobListReturned)).toBe(true)
  await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))))
  await expect(page.getByRole('heading', { name: 'Temporary TypeScript search', exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Saved jobs', exact: true })
    .getByRole('button', { name: /Temporary TypeScript search/ })).toBeVisible()
  await expect(names).toHaveText([...localNames].reverse())
  const saved = await page.evaluate(async () => {
    const jobs = await window.api.recruiting.listJobs()
    return { jobs, workspace: await window.api.recruiting.getJob(jobs[0].id) }
  })
  expect(saved.jobs).toHaveLength(1)
  expect(saved.workspace.temporary).not.toBe(true)
  expect(saved.workspace.job.posting.position).toBe('')
  expect(saved.workspace.job.posting.jobDescription).toBe('Temporary TypeScript search')
  expect(saved.workspace.response!.results.map((result) => result.resume.name)).toEqual([...localNames].reverse())
  expect(saved.workspace.response!.results.map((result) => result.llmReason)).toEqual([
    'Supported production systems and improved reliable TypeScript services.',
    'Built TypeScript services and coached developers.'
  ])
  await page.reload()
  await expect(page.getByText('Reordered by Sonnet 5', { exact: true })).toBeVisible()
  await expect(names).toHaveText([...localNames].reverse())
  expect(await application.evaluate(() => (globalThis as any).approvedRequests)).toHaveLength(1)

  await page.getByRole('button', { name: 'Express search', exact: true }).click()
  await page.getByRole('textbox', { name: 'Job description', exact: true }).fill('Express search to wipe')
  await page.getByRole('button', { name: 'Find matches', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open express search', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Delete all data…', exact: true }).click()
  await expect(page.getByText('All data deleted.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open express search', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Create your first job', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toEqual([])
})

test('requires exact consent for a saved job rerank and preserves independent shortlist order', async ({}, testInfo) => {
  await prepareClaudeFixtures()

  await page.getByRole('button', { name: '+ New job', exact: true }).click()
  await page.getByLabel('Position').fill('Senior TypeScript engineer')
  await page.getByLabel('Job description', { exact: true }).fill('Lead a reliable TypeScript platform migration.')
  await page.getByLabel('Requirements').fill('TypeScript\nCloud services\nTeam leadership')
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await page.getByRole('button', { name: 'Find matches' }).click()
  const names = page.locator('.recruit-candidate-table tbody .recruit-name')
  await expect(names).toHaveCount(2)
  const localNames = await names.allTextContents()
  const localJob = await page.evaluate(async () => {
    const [job] = await window.api.recruiting.listJobs()
    return window.api.recruiting.getJob(job.id)
  })
  expect(await page.evaluate(() => 'search' in window.api)).toBe(false)

  // Choose and manually order a shortlist before Claude reverses the candidate
  // ranking, so the two independently persisted orders can be distinguished.
  await page.getByRole('button', { name: `Shortlist ${localNames[1]}`, exact: true }).click()
  await page.getByRole('button', { name: `Shortlist ${localNames[0]}`, exact: true }).click()
  await page.getByRole('button', { name: 'Shortlist 2', exact: true }).click()
  await page.getByRole('button', { name: `Move ${localNames[0]} up`, exact: true }).click()
  await expect(names).toHaveText(localNames)
  await page.getByRole('button', { name: 'Candidates 2', exact: true }).click()
  const rerank = page.getByRole('button', { name: 'Rerank with Sonnet 5' })
  await expect(rerank).toBeVisible()
  await rerank.click()

  const dialog = page.getByRole('dialog', { name: 'Review data sent to Anthropic' })
  await expect(dialog).toBeVisible()
  const dataToggle = dialog.locator('button[aria-controls]')
  const cancel = dialog.getByRole('button', { name: 'Cancel' })
  const approve = dialog.getByRole('button', { name: 'Approve and send' })
  await expect(dataToggle).toHaveAccessibleName('See exported data')
  await expect(dataToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog.locator('.consent-payload')).toBeHidden()
  await expect(dialog.getByText('Sonnet 5 sends data to Anthropic to reorder these 2 candidates.', { exact: true })).toBeVisible()
  await expect(dialog.locator('.consent-summary dt')).toHaveText(['Sent', 'Redacted', 'API key'])
  await expect(cancel).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('claude-consent-english-default.png'), fullPage: true, animations: 'disabled' })
  await page.keyboard.press('Shift+Tab')
  await expect(dataToggle).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(approve).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dataToggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dataToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(dataToggle).toHaveAccessibleName('Hide exported data')
  await expect(dialog.getByRole('heading', { name: 'Exact outbound request' })).toBeVisible()
  await expect(dialog.locator('.consent-payload')).toBeVisible()
  const payload = await dialog.locator('.consent-payload').innerText()
  expect(payload).toContain('candidate-01')
  expect(payload).not.toContain('Private Candidate')
  expect(payload).not.toContain('one@example.com')
  expect(payload).not.toContain('+966 50 111 2233')

  await page.keyboard.press('Tab')
  await expect(dialog.locator('.consent-payload')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.locator('.consent-payload')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dataToggle).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('claude-consent-english-expanded.png'), fullPage: true, animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(rerank).toBeFocused()
  await expect(names).toHaveText(localNames)
  expect((await page.evaluate((jobId) => window.api.recruiting.getJob(jobId), localJob.job.id)).response?.results
    .map((result) => result.resume.recordKey)).toEqual(localJob.response!.results.map((result) => result.resume.recordKey))

  await installClaudeProvider(true)
  await rerank.click()
  await expect(dialog).toBeVisible()
  await expect(dataToggle).toHaveAccessibleName('See exported data')
  await expect(dataToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog.locator('.consent-payload')).toBeHidden()
  await expect(cancel).toBeFocused()
  await dataToggle.click()
  await expect(dialog.locator('.consent-payload')).toBeVisible()
  const approvedPayload = JSON.parse(await dialog.locator('.consent-payload').innerText())
  expect(await application.evaluate(() => (globalThis as any).approvedRequests)).toEqual([])
  await approve.click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => application.evaluate(() => (globalThis as any).approvedRequests)).toEqual([approvedPayload])
  await expect(page.getByRole('button', { name: 'Refresh matches', exact: true })).toBeDisabled()

  // A duplicate import refreshes Jobs without changing the backend ranking
  // source. Let its old local snapshot load before the approved provider reply
  // arrives; the saved rerank must still become visible without reopening.
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('ev:ingestProgress', {
      jobId: 'duplicate-import', processed: 1, total: 1, currentFile: '', done: true
    })
  })
  await expect(page.getByRole('button', { name: 'Refresh matches', exact: true })).toBeEnabled()
  await expect(names).toHaveText(localNames)
  await application.evaluate(() => { (globalThis as any).releaseProviderResponse() })
  await expect(page.getByText('Reordered by Sonnet 5', { exact: true })).toBeVisible()
  await expect(page.locator('.recruit-llm-reason .tag')).toHaveText(['Sonnet 5', 'Sonnet 5'])
  await expect(names).toHaveText([...localNames].reverse())
  expect(await application.evaluate(() => (globalThis as any).approvedRequests)).toEqual([approvedPayload])
  expect(await application.evaluate(() => (globalThis as any).nativeConfirmations)).toEqual([
    expect.objectContaining({ buttons: ['Cancel', 'Send to Anthropic'], defaultId: 0, cancelId: 0 })
  ])

  // Reopening reloads the saved job snapshot; it must retain Claude's reasons
  // and ordering while the recruiter's manual shortlist remains unchanged.
  await page.reload()
  await expect(page.getByText('Reordered by Sonnet 5', { exact: true })).toBeVisible()
  await expect(names).toHaveText([...localNames].reverse())
  const reopened = await page.evaluate((jobId) => window.api.recruiting.getJob(jobId), localJob.job.id)
  expect(reopened.response!.results.map((result) => result.resume.recordKey))
    .toEqual([...localJob.response!.results.map((result) => result.resume.recordKey)].reverse())
  expect(reopened.response!.results.map((result) => result.llmReason)).toEqual([
    'Supported production systems and improved reliable TypeScript services.',
    'Built TypeScript services and coached developers.'
  ])
  await page.getByRole('button', { name: 'Shortlist 2', exact: true }).click()
  await expect(names).toHaveText(localNames)

  await page.getByRole('button', { name: 'Refresh matches', exact: true }).click()
  await expect(rerank).toBeEnabled()
  await page.evaluate(() => window.api.settings.setRerank(false))
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(rerank).toBeDisabled()
  await page.evaluate(() => window.api.settings.setRerank(true))
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(rerank).toBeEnabled()
  await page.getByRole('button', { name: 'Edit job', exact: true }).click()
  await page.getByRole('textbox', { name: 'Position', exact: true }).fill('Updated TypeScript engineer vacancy')
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await expect(rerank).toBeDisabled()
  expect(await application.evaluate(() => (globalThis as any).approvedRequests)).toHaveLength(1)
})

test('chooses AI providers and models, keeps keys separate, and reranks with exact OpenAI consent', async ({}, testInfo) => {
  await prepareClaudeFixtures()
  await installOpenAIProvider()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const provider = page.getByRole('combobox', { name: 'AI provider', exact: true })
  const model = page.getByRole('combobox', { name: 'AI model', exact: true })
  const enabled = page.getByRole('checkbox', { name: 'Enable reranking', exact: true })
  await expect(provider).toHaveValue('anthropic')
  await expect(model).toHaveValue('claude-sonnet-5')
  await expect(provider.locator('option')).toHaveText(['Anthropic', 'OpenAI'])
  await expect(model.locator('option')).toHaveText(['Sonnet 5', 'Opus 5', 'Fable 5.1'])
  await expect(page.getByText('Anthropic API key stored', { exact: true })).toBeVisible()
  await expect(enabled).toBeChecked()
  for (const choice of ['claude-opus-5', 'claude-fable-5-1']) {
    await model.selectOption(choice)
    await expect(model).toHaveValue(choice)
    await expect(model).toBeEnabled()
  }
  await provider.selectOption('openai')
  await expect(model).toHaveValue('gpt-4o-mini')
  await expect(model.locator('option')).toHaveText(['GPT-4o mini', 'GPT-5.6', 'GPT-6 Astra'])
  const openaiKey = page.getByLabel('OpenAI API key', { exact: true })
  await openaiKey.fill('draft-that-must-not-cross-provider')
  await provider.selectOption('anthropic')
  await expect(model).toHaveValue('claude-fable-5-1')
  await expect(page.getByText('Anthropic API key stored', { exact: true })).toBeVisible()
  await provider.selectOption('openai')
  await expect(openaiKey).toHaveValue('')
  for (const choice of ['gpt-5.6', 'gpt-6-astra', 'gpt-4o-mini']) {
    await model.selectOption(choice)
    await expect(model).toHaveValue(choice)
    await expect(model).toBeEnabled()
  }
  await openaiKey.fill('sk-openai-e2e-placeholder')
  await page.getByRole('button', { name: 'Save key', exact: true }).click()
  await expect(page.getByText('OpenAI API key stored', { exact: true })).toBeVisible()
  await expect(enabled).not.toBeChecked()
  await enabled.click()
  await expect(enabled).toBeChecked()
  await expect(enabled).toBeEnabled()
  await page.getByRole('button', { name: 'Remove key', exact: true }).click()
  await expect(openaiKey).toHaveValue('')
  await provider.selectOption('anthropic')
  await expect(page.getByText('Anthropic API key stored', { exact: true })).toBeVisible()
  await expect(enabled).not.toBeChecked()
  await provider.selectOption('openai')
  await openaiKey.fill('sk-openai-e2e-placeholder')
  await page.getByRole('button', { name: 'Save key', exact: true }).click()
  await expect(enabled).not.toBeChecked()
  await enabled.click()
  await expect(enabled).toBeChecked()
  await expect(enabled).toBeEnabled()
  expect(await application.evaluate(() => (globalThis as any).approvedRequests)).toEqual([])

  // Restart the complete application: both credentials and each provider's model
  // choice survive, without decrypting either key during startup.
  await application.close()
  await launchApplication()
  await installOpenAIProvider()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const restartedProvider = page.getByRole('combobox', { name: 'AI provider', exact: true })
  const restartedModel = page.getByRole('combobox', { name: 'AI model', exact: true })
  await expect(restartedProvider).toHaveValue('openai')
  await expect(restartedModel).toHaveValue('gpt-4o-mini')
  await expect(page.getByText('OpenAI API key stored', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Enable reranking', exact: true })).toBeChecked()
  expect((await page.evaluate(() => window.api.settings.get())).rerankModels).toEqual({ anthropic: 'claude-fable-5-1', openai: 'gpt-4o-mini' })
  await page.locator('section[aria-labelledby="rerank-heading"]').screenshot({ path: testInfo.outputPath('ai-settings-english.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Jobs', exact: true }).click()
  await page.getByRole('button', { name: '+ New job', exact: true }).click()
  await page.getByLabel('Position').fill('TypeScript platform engineer')
  await page.getByLabel('Job description', { exact: true }).fill('Build reliable TypeScript cloud services.')
  await page.getByLabel('Requirements').fill('TypeScript\nProduction services')
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await page.getByRole('button', { name: 'Find matches', exact: true }).click()
  const names = page.locator('.recruit-candidate-table tbody .recruit-name')
  await expect(names).toHaveCount(2)
  const localNames = await names.allTextContents()
  const [savedJob] = await page.evaluate(() => window.api.recruiting.listJobs())
  await page.getByRole('button', { name: 'Rerank with GPT-4o mini', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Review data sent to OpenAI', exact: true })
  await expect(review).toBeVisible()
  await expect(review.getByText('GPT-4o mini sends data to OpenAI to reorder these 2 candidates.', { exact: true })).toBeVisible()
  await expect(review.locator('.consent-payload')).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('openai-consent-english.png'), fullPage: true, animations: 'disabled' })
  await review.getByRole('button', { name: 'See exported data', exact: true }).click()
  const approvedBody = JSON.parse(await review.locator('.consent-payload').innerText())
  expect(approvedBody.model).toBe('gpt-4o-mini')
  expect(approvedBody.store).toBe(false)
  expect(JSON.stringify(approvedBody)).not.toMatch(/e2e-placeholder|Private Candidate|one@example\.com/)
  expect(await application.evaluate(() => (globalThis as any).approvedRequests)).toEqual([])
  await review.getByRole('button', { name: 'Approve and send', exact: true }).click()
  await expect(page.getByText('Reordered by GPT-4o mini', { exact: true })).toBeVisible()
  await expect(page.locator('.recruit-llm-reason .tag')).toHaveText(['GPT-4o mini', 'GPT-4o mini'])
  await expect(names).toHaveText([...localNames].reverse())
  expect(await application.evaluate(() => (globalThis as any).approvedRequests)).toEqual([{ url: 'https://api.openai.com/v1/responses', body: approvedBody }])
  expect((await page.evaluate((jobId) => window.api.recruiting.getJob(jobId), savedJob.id)).response?.rerankConfig).toEqual({ provider: 'openai', model: 'gpt-4o-mini' })

  // Changing the model must expose a new action on the same matched snapshot,
  // while keeping the first model's attribution until the new request succeeds.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await restartedModel.selectOption('gpt-5.6')
  await expect(restartedModel).toHaveValue('gpt-5.6')
  await expect(restartedModel).toBeEnabled()
  await page.getByRole('button', { name: 'Jobs', exact: true }).click()
  await expect(page.getByText('Reordered by GPT-4o mini', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Rerank with GPT-5.6', exact: true }).click()
  await expect(review).toBeVisible()
  await expect(review.locator('.consent-payload')).toBeHidden()
  await review.getByRole('button', { name: 'See exported data', exact: true }).click()
  const secondBody = JSON.parse(await review.locator('.consent-payload').innerText())
  expect(secondBody.model).toBe('gpt-5.6')
  expect(secondBody.store).toBe(false)
  await review.getByRole('button', { name: 'Approve and send', exact: true }).click()
  await expect(page.getByText('Reordered by GPT-5.6', { exact: true })).toBeVisible()
  await expect(page.locator('.recruit-llm-reason .tag')).toHaveText(['GPT-5.6', 'GPT-5.6'])
  expect(await application.evaluate(() => (globalThis as any).approvedRequests)).toEqual([
    { url: 'https://api.openai.com/v1/responses', body: approvedBody },
    { url: 'https://api.openai.com/v1/responses', body: secondBody }
  ])
  expect(await application.evaluate(() => (globalThis as any).nativeConfirmations)).toEqual([
    expect.objectContaining({ buttons: ['Cancel', 'Send to OpenAI'], defaultId: 0, cancelId: 0 }),
    expect.objectContaining({ buttons: ['Cancel', 'Send to OpenAI'], defaultId: 0, cancelId: 0 })
  ])
  await page.reload()
  await expect(page.getByText('Reordered by GPT-5.6', { exact: true })).toBeVisible()
  expect((await page.evaluate((jobId) => window.api.recruiting.getJob(jobId), savedJob.id)).response?.rerankConfig).toEqual({ provider: 'openai', model: 'gpt-5.6' })

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'AI provider', exact: true }).selectOption('anthropic')
  await expect(page.getByRole('combobox', { name: 'AI model', exact: true })).toHaveValue('claude-fable-5-1')
  await expect(page.getByText('Anthropic API key stored', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'العربية', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('combobox', { name: translate('ar', 'AI provider'), exact: true })).toHaveValue('anthropic')
  await page.locator('section[aria-labelledby="rerank-heading"]').screenshot({ path: testInfo.outputPath('ai-settings-arabic.png'), animations: 'disabled' })
  await page.getByRole('button', { name: translate('ar', 'Jobs'), exact: true }).click()
  await expect(page.getByText(translate('ar', 'Reordered by {model}', { model: 'GPT-5.6' }), { exact: true })).toBeVisible()
  await page.getByRole('button', { name: translate('ar', 'Rerank with {model}', { model: 'Fable 5.1' }), exact: true }).click()
  const anthropicReview = page.getByRole('dialog', { name: translate('ar', 'Review data sent to {provider}', { provider: 'Anthropic' }), exact: true })
  await expect(anthropicReview).toBeVisible()
  await expect(anthropicReview.getByText(translate('ar', '{model} sends data to {provider} to reorder these {count} candidates.', { model: 'Fable 5.1', provider: 'Anthropic', count: 2 }), { exact: true })).toBeVisible()
  await expect(anthropicReview.locator('.consent-payload')).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('anthropic-model-consent-arabic.png'), fullPage: true, animations: 'disabled' })
  await anthropicReview.getByRole('button', { name: translate('ar', 'Cancel'), exact: true }).click()
  expect(await application.evaluate(() => (globalThis as any).approvedRequests)).toHaveLength(2)
})

test('shows a concise Arabic Claude notice with keyboard-accessible exported data', async ({}, testInfo) => {
  const ar = (message: string): string => translate('ar', message)
  await prepareClaudeFixtures()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'العربية', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.getByRole('button', { name: ar('Jobs'), exact: true }).click()
  await page.getByRole('button', { name: ar('Express search'), exact: true }).click()
  await page.getByRole('textbox', { name: ar('Job description'), exact: true }).fill('مهندس TypeScript')
  await page.getByRole('textbox', { name: ar('Requirements'), exact: true }).fill('TypeScript\nCloud services')
  await page.getByRole('button', { name: ar('Find matches'), exact: true }).click()
  await expect(page.locator('.recruit-candidate-table tbody .recruit-name')).toHaveCount(2)

  const rerank = page.getByRole('button', { name: translate('ar', 'Rerank with {model}', { model: 'Sonnet 5' }), exact: true })
  await rerank.click()
  const dialog = page.getByRole('dialog', { name: translate('ar', 'Review data sent to {provider}', { provider: 'Anthropic' }), exact: true })
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((element) => getComputedStyle(element).direction)).toBe('rtl')
  await expect(dialog.getByText(translate('ar', '{model} sends data to {provider} to reorder these {count} candidates.', { model: 'Sonnet 5', provider: 'Anthropic', count: 2 }), { exact: true })).toBeVisible()
  await expect(dialog.locator('.consent-summary dt')).toHaveText(['Sent', 'Redacted', 'API key'].map(ar))
  await expect(dialog.locator('.consent-summary dd')).toHaveText([
    'The job posting, selected CV passages, years of experience, education, and matched or missing skills.',
    'Detected names, contact details, locations, filenames, and local paths.',
    'Used separately to authenticate the request. It is not included in the data preview.'
  ].map(ar))
  const dataToggle = dialog.locator('button[aria-controls]')
  await expect(dataToggle).toHaveAccessibleName(ar('See exported data'))
  expect(ar('See exported data')).not.toBe('See exported data')
  await expect(dataToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog.locator('.consent-payload')).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('claude-consent-arabic-default.png'), fullPage: true, animations: 'disabled' })

  await dataToggle.focus()
  await page.keyboard.press('Enter')
  await expect(dataToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(dataToggle).toHaveAccessibleName(ar('Hide exported data'))
  await expect(dialog.getByRole('heading', { name: ar('Exact outbound request'), exact: true })).toBeVisible()
  const payload = dialog.locator('.consent-payload')
  await expect(payload).toBeVisible()
  await expect(payload).toHaveAttribute('dir', 'ltr')
  expect(JSON.parse(await payload.innerText()).messages).toBeInstanceOf(Array)
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    root: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }))
  expect(metrics.root).toBeLessThanOrEqual(metrics.viewport + 1)
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1)
  await page.screenshot({ path: testInfo.outputPath('claude-consent-arabic-expanded.png'), fullPage: true, animations: 'disabled' })
  await page.keyboard.press('Space')
  await expect(dataToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(payload).toBeHidden()
  await page.keyboard.press('Enter')
  await expect(payload).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(rerank).toBeFocused()
  await rerank.click()
  await expect(dialog).toBeVisible()
  await expect(dataToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(payload).toBeHidden()
  await dialog.getByRole('button', { name: ar('Cancel'), exact: true }).click()
  expect(await page.evaluate(() => window.api.recruiting.listJobs())).toEqual([])
})

test('allows only one process to own a Qumaa data directory', async () => {
  const launch = await application.evaluate(({ app }) => {
    ;(globalThis as any).secondLaunchCount = 0
    app.on('second-instance', () => { (globalThis as any).secondLaunchCount += 1 })
    return { executable: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] }
  })
  // Launch as a user would. Replaying Playwright's --require loader and debug
  // transport arguments without its environment/pipes can abort before Qumaa
  // starts, particularly on Windows, and never exercises the instance lock.
  const secondEnv: NodeJS.ProcessEnv = {
    ...process.env,
    QUMAA_E2E_USER_DATA: scratch,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  }
  delete secondEnv.ELECTRON_RUN_AS_NODE
  delete secondEnv.NODE_OPTIONS
  const second = spawn(launch.executable, launch.args, {
    cwd: ROOT,
    env: secondEnv,
    shell: false,
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let stderr = ''
  second.stderr?.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-8_000) })
  const [code, signal] = (await once(second, 'exit')) as [number | null, NodeJS.Signals | null]
  expect(signal).toBeNull()
  expect(code, stderr).toBe(0)
  await expect.poll(() => application.evaluate(() => (globalThis as any).secondLaunchCount)).toBe(1)
  expect(application.windows()).toHaveLength(1)
})

test('opens the creator LinkedIn profile through the fixed browser action', async () => {
  await application.evaluate(({ shell }) => {
    ;(shell as any).openExternal = async (url: string) => { (globalThis as any).openedCreatorUrl = url }
  })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByText('Fawaz Aljathnan', { exact: true })).toBeVisible()
  const linkedin = page.getByRole('link', { name: 'View Fawaz Aljathnan on LinkedIn (opens in your browser)' })
  await expect(linkedin).toHaveAttribute('href', 'https://www.linkedin.com/in/fawazsalehq/')
  await linkedin.click()
  await expect.poll(() => application.evaluate(() => (globalThis as any).openedCreatorUrl))
    .toBe('https://www.linkedin.com/in/fawazsalehq/')
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
  await page.getByLabel('Importance of criterion 1').selectOption('required')
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
  await expect(comparison.getByText('Nearest passage · experience · Review needed', { exact: true }).first()).toBeVisible()
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
  expect(persisted.job.criteria.slice(0, 2).map((criterion) => criterion.importance)).toEqual(['required', 'preferred'])
  expect(persisted.job.criteria.slice(2).every((criterion) => criterion.importance === 'unspecified')).toBe(true)
  expect(persisted.response?.results).toHaveLength(3)
})

test('records dated job status and hiring decisions with optional distinct backups in English and Arabic', async ({}, testInfo) => {
  await page.evaluate(async () => {
    const candidates = [
      ['Maya Stone', 'maya@example.com', 'Led TypeScript platform migrations and coached engineers. Designed reliable AWS services and operated PostgreSQL databases.'],
      ['Noah Grant', 'noah@example.com', 'Developed TypeScript APIs and cloud systems. Improved automated tests and supported production services on AWS.'],
      ['Lina Wells', 'lina@example.com', 'Built Node.js services and TypeScript applications. Maintained production observability and mentored application developers.']
    ]
    for (const [name, email, experience] of candidates) {
      await window.api.ingest.text(`${name}\n${email}\n\nWORK EXPERIENCE\nSoftware engineer, 2018 to 2025. ${experience}\n\nSKILLS\nTypeScript, AWS, Node.js`, name)
    }
  })
  await page.reload()
  await page.getByRole('button', { name: '+ New job', exact: true }).click()
  await page.getByRole('textbox', { name: 'Position', exact: true }).fill('Platform hiring decision')
  await page.getByRole('textbox', { name: 'Job description', exact: true }).fill('Build reliable TypeScript services and mentor engineers.')
  await page.getByRole('textbox', { name: 'Requirements', exact: true }).fill('TypeScript\nAWS')
  await expect(page.getByRole('combobox', { name: 'Job status', exact: true })).toHaveCount(0)
  const beforeCreation = Date.now()
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Job status', exact: true })
  await expect(panel.getByRole('heading', { name: 'Current status: Open', exact: true })).toBeVisible()
  const [created] = await page.evaluate(() => window.api.recruiting.listJobs())
  expect(created.createdAt).toBeGreaterThanOrEqual(beforeCreation)
  expect(created.createdAt).toBeLessThanOrEqual(Date.now())
  expect(created.statusHistory).toEqual([
    expect.objectContaining({ kind: 'created', status: 'open', at: created.createdAt })
  ])
  await expect(panel.locator('.recruit-status-dates')).toContainText('Created ')
  await panel.getByText('Status history', { exact: true }).click()
  const history = panel.locator('.recruit-status-history')
  await expect(history.getByText('Created as Open', { exact: true })).toBeVisible()
  await expect(history.locator('time')).toHaveAttribute('datetime', new Date(created.createdAt).toISOString())

  await panel.getByRole('button', { name: 'Change status', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Change status', exact: true })
  await dialog.getByRole('combobox', { name: 'Job status', exact: true }).selectOption('on-hold')
  const beforeHold = Date.now()
  await dialog.getByRole('button', { name: 'Save status', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.getByRole('heading', { name: 'Current status: On hold', exact: true })).toBeVisible()
  const held = await page.evaluate((id) => window.api.recruiting.getJob(id), created.id)
  expect(held.job.createdAt).toBe(created.createdAt)
  expect(held.job.statusHistory).toHaveLength(2)
  const holdEvent = held.job.statusHistory![1]
  expect(holdEvent).toMatchObject({ kind: 'status-changed', status: 'on-hold' })
  expect(holdEvent.at).toBeGreaterThanOrEqual(beforeHold)
  expect(holdEvent.at).toBeLessThanOrEqual(Date.now())
  await expect(history.getByText('Open → On hold', { exact: true })).toBeVisible()
  await expect(history.locator('time').first()).toHaveAttribute('datetime', new Date(holdEvent.at).toISOString())
  await page.getByRole('button', { name: 'Find matches', exact: true }).click()
  await expect(page.locator('.recruit-candidate-table tbody .recruit-name')).toHaveCount(3)

  await panel.getByRole('button', { name: 'Change status', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Job status', exact: true }).selectOption('filled')
  const hired = dialog.getByRole('combobox', { name: /^Hired candidate/ })
  const backup2 = dialog.getByRole('combobox', { name: /^Backup #2/ })
  const backup3 = dialog.getByRole('combobox', { name: /^Backup #3/ })
  const saveStatus = dialog.getByRole('button', { name: 'Save status', exact: true })
  await expect(hired).toBeEnabled()
  await expect(saveStatus).toBeDisabled()
  await expect(backup3).toBeDisabled()
  const resumes = await page.evaluate(() => window.api.resumes.list())
  const maya = resumes.find((resume) => resume.name === 'Maya Stone')!
  const noah = resumes.find((resume) => resume.name === 'Noah Grant')!
  const lina = resumes.find((resume) => resume.name === 'Lina Wells')!
  await hired.selectOption(maya.recordKey)
  await expect(backup2.locator('option').filter({ hasText: 'Maya Stone' })).toHaveCount(0)
  await expect(saveStatus).toBeEnabled()
  const beforeFill = Date.now()
  await saveStatus.click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.getByRole('heading', { name: 'Current status: Filled', exact: true })).toBeVisible()
  const filled = await page.evaluate((id) => window.api.recruiting.getJob(id), created.id)
  expect(filled.job.placement).toEqual({
    hired: { recordKey: maya.recordKey, name: 'Maya Stone' }, backup2: null, backup3: null
  })
  expect(filled.job.statusHistory).toHaveLength(3)
  const fillEvent = filled.job.statusHistory![2]
  expect(fillEvent).toMatchObject({ kind: 'status-changed', status: 'filled', placement: filled.job.placement })
  expect(fillEvent.at).toBeGreaterThanOrEqual(beforeFill)
  expect(fillEvent.at).toBeLessThanOrEqual(Date.now())
  await expect(history.getByText('On hold → Filled', { exact: true })).toBeVisible()

  // Posting edits must preserve the status decision and its original dates.
  await page.getByRole('button', { name: 'Edit job', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Job status', exact: true })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Job description', exact: true }).fill('Build reliable TypeScript services, mentor engineers, and maintain observability.')
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await expect(panel.getByRole('heading', { name: 'Current status: Filled', exact: true })).toBeVisible()
  const edited = await page.evaluate((id) => window.api.recruiting.getJob(id), created.id)
  expect(edited.job.placement).toEqual(filled.job.placement)
  expect(edited.job.statusHistory).toEqual(filled.job.statusHistory)
  expect(edited.job.createdAt).toBe(created.createdAt)

  await panel.getByRole('button', { name: 'Edit hiring details', exact: true }).click()
  await expect(hired).toHaveValue(maya.recordKey)
  await expect(saveStatus).toBeDisabled()
  await backup2.selectOption(noah.recordKey)
  await expect(backup3).toBeEnabled()
  await expect(backup3.locator('option').filter({ hasText: 'Maya Stone' })).toHaveCount(0)
  await expect(backup3.locator('option').filter({ hasText: 'Noah Grant' })).toHaveCount(0)
  await backup3.selectOption(lina.recordKey)
  await expect(hired.locator('option').filter({ hasText: 'Noah Grant' })).toHaveCount(0)
  await expect(hired.locator('option').filter({ hasText: 'Lina Wells' })).toHaveCount(0)
  await backup2.selectOption('')
  await expect(backup3).toHaveValue('')
  await expect(backup3).toBeDisabled()
  await backup2.selectOption(noah.recordKey)
  await backup3.selectOption(lina.recordKey)
  await page.screenshot({ path: testInfo.outputPath('hiring-picker-english.png'), fullPage: true, animations: 'disabled' })
  const beforeBackups = Date.now()
  await saveStatus.click()
  await expect(dialog).toHaveCount(0)
  const recorded = await page.evaluate((id) => window.api.recruiting.getJob(id), created.id)
  expect(recorded.job.placement).toEqual({
    hired: { recordKey: maya.recordKey, name: 'Maya Stone' },
    backup2: { recordKey: noah.recordKey, name: 'Noah Grant' },
    backup3: { recordKey: lina.recordKey, name: 'Lina Wells' }
  })
  expect(recorded.job.statusHistory).toHaveLength(4)
  const placementEvent = recorded.job.statusHistory![3]
  expect(placementEvent).toMatchObject({ kind: 'placement-updated', status: 'filled', placement: recorded.job.placement })
  expect(placementEvent.at).toBeGreaterThanOrEqual(beforeBackups)
  expect(placementEvent.at).toBeLessThanOrEqual(Date.now())
  const hiringCards = panel.locator('.recruit-hiring-cards')
  await expect(hiringCards.getByRole('article', { name: 'Hired candidate', exact: true })).toContainText('Maya Stone')
  await expect(hiringCards.getByRole('article', { name: 'Backup #2', exact: true })).toContainText('Noah Grant')
  await expect(hiringCards.getByRole('article', { name: 'Backup #3', exact: true })).toContainText('Lina Wells')
  await panel.getByText('Status history', { exact: true }).click()
  await expect(history.getByText('Hiring details updated', { exact: true })).toBeVisible()
  await expect(history.locator('time').first()).toHaveAttribute('datetime', new Date(placementEvent.at).toISOString())
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('hiring-history-english.png'), fullPage: true, animations: 'disabled' })
  await hiringCards.getByRole('article', { name: 'Hired candidate', exact: true }).getByRole('button', { name: 'View CV', exact: true }).click()
  const evidence = page.getByRole('dialog', { name: 'Details for Maya Stone', exact: true })
  await expect(evidence.locator('.raw-text')).toContainText('Led TypeScript platform migrations and coached engineers.')
  await evidence.getByRole('button', { name: 'Close', exact: true }).click()

  await page.reload()
  await expect(panel.getByRole('heading', { name: 'Current status: Filled', exact: true })).toBeVisible()
  expect((await page.evaluate((id) => window.api.recruiting.getJob(id), created.id)).job.statusHistory).toEqual(recorded.job.statusHistory)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'العربية', exact: true }).click()
  await page.getByRole('button', { name: translate('ar', 'Jobs'), exact: true }).click()
  const arabicPanel = page.getByRole('region', { name: translate('ar', 'Job status'), exact: true })
  await expect(arabicPanel.getByRole('heading', { name: translate('ar', 'Current status: {status}', { status: translate('ar', 'Filled') }), exact: true })).toBeVisible()
  expect(await arabicPanel.evaluate((element) => getComputedStyle(element).direction)).toBe('rtl')
  for (const [role, name] of [['Hired candidate', 'Maya Stone'], ['Backup #2', 'Noah Grant'], ['Backup #3', 'Lina Wells']]) {
    await expect(arabicPanel.getByRole('article', { name: translate('ar', role), exact: true })).toContainText(name)
  }
  await arabicPanel.getByText(translate('ar', 'Status history'), { exact: true }).click()
  await expect(arabicPanel.getByText(translate('ar', 'Hiring details updated'), { exact: true })).toBeVisible()
  await expect(arabicPanel.locator('.recruit-status-history time')).toHaveCount(4)
  await arabicPanel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('hiring-history-arabic.png'), fullPage: true, animations: 'disabled' })
  await arabicPanel.getByRole('button', { name: translate('ar', 'Edit hiring details'), exact: true }).click()
  const arabicDialog = page.getByRole('dialog', { name: translate('ar', 'Change status'), exact: true })
  await expect(arabicDialog.getByRole('combobox', { name: /^المرشح الذي تم تعيينه/ })).toHaveValue(maya.recordKey)
  await expect(arabicDialog.getByRole('combobox', { name: /^البديل رقم ٢/ })).toHaveValue(noah.recordKey)
  await expect(arabicDialog.getByRole('combobox', { name: /^البديل رقم ٣/ })).toHaveValue(lina.recordKey)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('hiring-picker-arabic.png'), fullPage: true, animations: 'disabled' })
  await arabicDialog.getByRole('button', { name: translate('ar', 'Cancel'), exact: true }).click()
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
