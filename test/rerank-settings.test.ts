import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RERANK_CONFIG,
  DEFAULT_RERANK_MODELS,
  RERANK_MODELS,
  rerankConsentKey,
  type RerankConfig,
  type RerankProvider
} from '../src/shared/rerank.js'
import { ipcSchemas, parseIpc } from '../src/main/ipc-validation.js'

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  protectedProviders: new Set<string>(),
  transactions: 0
}))

vi.mock('../src/main/db/index.js', () => ({
  getSetting: (key: string) => state.settings.get(key) ?? null,
  setSetting: (key: string, value: string | null) => {
    if (value === null) state.settings.delete(key)
    else state.settings.set(key, value)
  },
  getDb: () => ({ transaction: <T>(fn: () => T) => () => {
    state.transactions++
    return fn()
  } })
}))
vi.mock('../src/main/secrets.js', () => ({
  hasApiKey: (provider: RerankProvider) => state.protectedProviders.has(provider)
}))

const {
  clearProviderRerankConsent,
  getRerankConfig,
  getRerankModels,
  RERANK_ENABLED_KEY,
  setRerankConfig
} = await import('../src/main/search/rerank-settings.js')

beforeEach(() => {
  state.settings.clear()
  state.protectedProviders.clear()
  state.transactions = 0
})

describe('AI reranking settings', () => {
  it('preserves the Anthropic default for existing installations and rejects damaged model memories', () => {
    expect(getRerankConfig()).toEqual(DEFAULT_RERANK_CONFIG)
    expect(getRerankModels()).toEqual(DEFAULT_RERANK_MODELS)
    state.settings.set('rerankProvider', 'other-provider')
    state.settings.set('rerankModel:anthropic', DEFAULT_RERANK_MODELS.openai)
    state.settings.set('rerankModel:openai', 'unavailable-model')
    expect(getRerankConfig()).toEqual(DEFAULT_RERANK_CONFIG)
    expect(getRerankModels()).toEqual(DEFAULT_RERANK_MODELS)
  })

  it('remembers a different valid model for each provider and saves each selection atomically', () => {
    const anthropic: RerankConfig = { provider: 'anthropic', model: RERANK_MODELS.anthropic[1].id }
    const openai: RerankConfig = { provider: 'openai', model: RERANK_MODELS.openai[2].id }
    setRerankConfig(anthropic)
    setRerankConfig(openai)
    expect(getRerankConfig()).toEqual(openai)
    expect(getRerankModels()).toEqual({ anthropic: anthropic.model, openai: openai.model })
    setRerankConfig({ provider: 'anthropic', model: getRerankModels().anthropic })
    expect(getRerankConfig()).toEqual(anthropic)
    expect(getRerankModels().openai).toBe(openai.model)
    expect(state.transactions).toBe(3)
  })

  it('disables reranking when switching to a provider without its own protected key and never re-enables it', () => {
    state.protectedProviders.add('anthropic')
    state.settings.set(RERANK_ENABLED_KEY, 'true')
    setRerankConfig({ provider: 'openai', model: DEFAULT_RERANK_MODELS.openai })
    expect(state.settings.get(RERANK_ENABLED_KEY)).toBe('false')
    setRerankConfig(DEFAULT_RERANK_CONFIG)
    expect(state.settings.get(RERANK_ENABLED_KEY)).toBe('false')
    state.protectedProviders.add('openai')
    setRerankConfig({ provider: 'openai', model: DEFAULT_RERANK_MODELS.openai })
    expect(state.settings.get(RERANK_ENABLED_KEY)).toBe('false')
  })

  it('preserves explicit enablement when both providers have their own protected key', () => {
    state.protectedProviders.add('anthropic')
    state.protectedProviders.add('openai')
    state.settings.set(RERANK_ENABLED_KEY, 'true')
    setRerankConfig({ provider: 'openai', model: DEFAULT_RERANK_MODELS.openai })
    expect(state.settings.get(RERANK_ENABLED_KEY)).toBe('true')
  })

  it('rejects cross-provider models without touching stored preferences', () => {
    const original = new Map(state.settings)
    expect(() => setRerankConfig({ provider: 'anthropic', model: DEFAULT_RERANK_MODELS.openai }))
      .toThrow('supported model')
    expect(state.settings).toEqual(original)
    expect(state.transactions).toBe(0)
  })

  it('clears accepted notices only for the provider whose credential changed', () => {
    for (const provider of ['anthropic', 'openai'] as const) {
      for (const model of RERANK_MODELS[provider]) {
        state.settings.set(rerankConsentKey({ provider, model: model.id }), 'accepted')
      }
    }
    state.settings.set('claudeRerankConsent', 'legacy-accepted')
    clearProviderRerankConsent('openai')
    for (const model of RERANK_MODELS.openai) {
      expect(state.settings.has(rerankConsentKey({ provider: 'openai', model: model.id }))).toBe(false)
    }
    for (const model of RERANK_MODELS.anthropic) {
      expect(state.settings.get(rerankConsentKey({ provider: 'anthropic', model: model.id }))).toBe('accepted')
    }
    expect(state.settings.get('claudeRerankConsent')).toBe('legacy-accepted')
    clearProviderRerankConsent('anthropic')
    expect(state.settings.size).toBe(0)
  })
})

describe('provider/model IPC boundary', () => {
  it('accepts every supported provider/model pair', () => {
    for (const provider of ['anthropic', 'openai'] as const) {
      for (const model of RERANK_MODELS[provider]) {
        const config = { provider, model: model.id }
        expect(parseIpc(ipcSchemas.rerankConfig, config, 'AI selection')).toEqual(config)
      }
    }
  })

  it.each([
    null,
    {},
    { provider: 'openai' },
    { provider: 'anthropic', model: DEFAULT_RERANK_MODELS.openai },
    { provider: 'openai', model: DEFAULT_RERANK_MODELS.anthropic },
    { provider: 'other', model: DEFAULT_RERANK_MODELS.openai },
    { provider: 'openai', model: 'unavailable-model' },
    { provider: 'openai', model: DEFAULT_RERANK_MODELS.openai, endpoint: 'https://other.invalid' }
  ])('rejects malformed or unsupported selections: %j', (config) => {
    expect(() => parseIpc(ipcSchemas.rerankConfig, config, 'AI selection')).toThrow('Invalid AI selection')
  })

  it('rejects malformed credential provider arguments', () => {
    for (const provider of [null, '', 'other', {}, ['openai']]) {
      expect(() => parseIpc(ipcSchemas.rerankProvider, provider, 'AI provider')).toThrow('Invalid AI provider')
    }
  })
})
