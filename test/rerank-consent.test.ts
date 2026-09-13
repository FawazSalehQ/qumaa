import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { MatchResult } from '../src/shared/types.js'
import { DEFAULT_RERANK_CONFIG, RERANK_CONSENT_VERSION, rerankConsentKey } from '../src/shared/rerank.js'

const mocks = vi.hoisted(() => ({
  dialog: vi.fn(), getApiKey: vi.fn(), rerank: vi.fn(),
  settings: new Map<string, string>(), sourceChanged: false, credentialRevision: 'initial-key'
}))
vi.mock('electron', () => ({ dialog: { showMessageBox: mocks.dialog } }))
vi.mock('../src/main/db/index.js', () => ({
  getSetting: (key: string) => mocks.settings.get(key) ?? null,
  setSetting: (key: string, value: string) => mocks.settings.set(key, value)
}))
vi.mock('../src/main/secrets.js', () => ({ hasApiKey: () => true, getApiKey: mocks.getApiKey, getApiKeyRevision: () => mocks.credentialRevision }))
vi.mock('../src/main/search/rerank-settings.js', () => ({
  getRerankConfig: () => ({ provider: mocks.settings.get('rerankProvider') ?? 'anthropic', model: mocks.settings.get('rerankModel') ?? 'claude-sonnet-5' })
}))
vi.mock('../src/main/language.js', () => ({ nativeText: (text: string, values: Record<string, string> = {}) => text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? key) }))
vi.mock('../src/main/search/rerank.js', () => ({ rerank: mocks.rerank }))

import { previewRerankSession, rerankWithConfirmation } from '../src/main/search/rerank-consent.js'
import { searchSessions } from '../src/main/search/sessions.js'

const getWindow = () => ({}) as BrowserWindow
const candidates = [1, 2].map((id): MatchResult => ({
  resume: { id, recordKey: String(id).repeat(64), name: `Candidate ${id}`, fileName: `Resume ${id}.pdf`, filePath: '', importedAt: id, email: null, phone: null, location: null, yearsExperience: 5, educationLevel: null, skills: ['TypeScript'] },
  score: .8, breakdown: { semantic: .8, lexical: .8, skills: .8 }, matchedSkills: ['TypeScript'], missingSkills: [], evidence: [{ section: 'experience', similarity: .8, text: 'Built reliable TypeScript services.' }]
}))

function request() {
  const response = searchSessions.create('Build reliable TypeScript services', {
    results: candidates, requiredSkills: ['TypeScript'], elapsedMs: 1, totalCandidates: 2
  })
  const source = () => {
    if (mocks.sourceChanged) throw new Error('Job changed')
    return searchSessions.get(response.sessionId)
  }
  const preview = previewRerankSession(source())
  return { args: { sessionId: response.sessionId, approvalToken: preview.approvalToken }, source }
}

beforeEach(() => {
  vi.resetAllMocks()
  searchSessions.clear()
  mocks.settings.clear()
  mocks.settings.set('rerankEnabled', 'true')
  mocks.sourceChanged = false
  mocks.credentialRevision = 'initial-key'
  mocks.dialog.mockResolvedValue({ response: 1 })
  mocks.getApiKey.mockReturnValue('synthetic-key')
  mocks.rerank.mockResolvedValue([])
})

describe('native approval for job reranking', () => {
  it('consumes approval once and never unlocks credentials or sends when cancelled', async () => {
    const { args, source } = request()
    const save = vi.fn()
    mocks.dialog.mockResolvedValue({ response: 0 })
    await expect(rerankWithConfirmation(args, getWindow, source, save)).rejects.toThrow('cancelled')
    expect(mocks.getApiKey).not.toHaveBeenCalled()
    expect(mocks.rerank).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    await expect(rerankWithConfirmation(args, getWindow, source, save)).rejects.toThrow('approval')
    expect(mocks.dialog).toHaveBeenCalledTimes(1)
  })

  it('rechecks the job after native approval before sending its evidence', async () => {
    const { args, source } = request()
    mocks.dialog.mockImplementation(async () => { mocks.sourceChanged = true; return { response: 1 } })
    await expect(rerankWithConfirmation(args, getWindow, source, vi.fn())).rejects.toThrow('Job changed')
    expect(mocks.getApiKey).not.toHaveBeenCalled()
    expect(mocks.rerank).not.toHaveBeenCalled()
  })

  it('does not overwrite a changed job with a late provider result', async () => {
    const { args, source } = request()
    const save = vi.fn()
    mocks.rerank.mockImplementation(async () => { mocks.sourceChanged = true; return [] })
    await expect(rerankWithConfirmation(args, getWindow, source, save)).rejects.toThrow('Job changed')
    expect(mocks.rerank).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
  })

  it('requires native confirmation on every send even with remembered policy consent', async () => {
    mocks.settings.set(rerankConsentKey(DEFAULT_RERANK_CONFIG), RERANK_CONSENT_VERSION)
    const save = vi.fn(() => 'saved workspace')
    for (let index = 0; index < 2; index++) {
      const { args, source } = request()
      await expect(rerankWithConfirmation(args, getWindow, source, save)).resolves.toBe('saved workspace')
    }
    expect(mocks.dialog).toHaveBeenCalledTimes(2)
    expect(mocks.rerank).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('requires a separate notice for each provider and model, ignoring legacy Claude consent', () => {
    mocks.settings.set('claudeRerankConsent', 'claude-rerank-v1')
    let current = request()
    expect(previewRerankSession(current.source()).consentRequired).toBe(true)
    mocks.settings.set(rerankConsentKey(DEFAULT_RERANK_CONFIG), RERANK_CONSENT_VERSION)
    expect(previewRerankSession(current.source()).consentRequired).toBe(false)
    mocks.settings.set('rerankModel', 'claude-opus-5')
    current = request()
    expect(previewRerankSession(current.source()).consentRequired).toBe(true)
    mocks.settings.set('rerankProvider', 'openai')
    mocks.settings.set('rerankModel', 'gpt-4o-mini')
    current = request()
    const preview = previewRerankSession(current.source())
    expect(preview.consentRequired).toBe(true)
    expect(preview.preview.provider).toBe('OpenAI')
  })

  it('sends only with the reviewed provider/model and its own credential', async () => {
    mocks.settings.set('rerankProvider', 'openai')
    mocks.settings.set('rerankModel', 'gpt-6-astra')
    const { args, source } = request()
    const save = vi.fn()
    await rerankWithConfirmation(args, getWindow, source, save)
    expect(mocks.dialog).toHaveBeenCalledWith(getWindow(), expect.objectContaining({
      buttons: ['Cancel', 'Send to OpenAI'], message: 'Send this search’s reviewed evidence to OpenAI using GPT-6 Astra?'
    }))
    expect(mocks.getApiKey).toHaveBeenCalledWith('openai')
    expect(mocks.rerank).toHaveBeenCalledWith(expect.objectContaining({ config: { provider: 'openai', model: 'gpt-6-astra' }, apiKey: 'synthetic-key' }))
    expect(save).toHaveBeenCalledWith([], { provider: 'openai', model: 'gpt-6-astra' })
    expect(mocks.settings.get(rerankConsentKey({ provider: 'openai', model: 'gpt-6-astra' }))).toBe(RERANK_CONSENT_VERSION)
  })

  it('rejects a model change after preview before opening native confirmation', async () => {
    const { args, source } = request()
    mocks.settings.set('rerankModel', 'claude-opus-5')
    await expect(rerankWithConfirmation(args, getWindow, source, vi.fn())).rejects.toThrow('approval')
    expect(mocks.dialog).not.toHaveBeenCalled()
    expect(mocks.getApiKey).not.toHaveBeenCalled()
  })

  it.each(['provider', 'key', 'revoke-and-restore'] as const)('rejects a %s change while native confirmation is open', async (change) => {
    const { args, source } = request()
    mocks.dialog.mockImplementation(async () => {
      if (change === 'provider') {
        mocks.settings.set('rerankProvider', 'openai')
        mocks.settings.set('rerankModel', 'gpt-4o-mini')
      } else if (change === 'key') mocks.credentialRevision = 'replacement-key'
      else searchSessions.clearApprovals()
      return { response: 1 }
    })
    await expect(rerankWithConfirmation(args, getWindow, source, vi.fn())).rejects.toThrow('settings changed')
    expect(mocks.getApiKey).not.toHaveBeenCalled()
    expect(mocks.rerank).not.toHaveBeenCalled()
    expect(mocks.settings.has(rerankConsentKey(DEFAULT_RERANK_CONFIG))).toBe(false)
    expect(() => source()).not.toThrow()
  })

  it('does not save a late response after a provider change during the network call', async () => {
    const { args, source } = request()
    const save = vi.fn()
    mocks.rerank.mockImplementation(async () => {
      mocks.settings.set('rerankProvider', 'openai')
      mocks.settings.set('rerankModel', 'gpt-4o-mini')
      return []
    })
    await expect(rerankWithConfirmation(args, getWindow, source, save)).rejects.toThrow('settings changed')
    expect(save).not.toHaveBeenCalled()
  })
})
