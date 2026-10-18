/** Supported API models, verified against provider documentation on 2026-09-12. */
export const RERANK_MODELS = {
  anthropic: [
    { id: 'claude-sonnet-5', label: 'Sonnet 5' },
    { id: 'claude-opus-5', label: 'Opus 5' },
    { id: 'claude-fable-5-1', label: 'Fable 5.1' }
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'gpt-5.6', label: 'GPT-5.6' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra' }
  ]
} as const

export type RerankProvider = keyof typeof RERANK_MODELS
export type ApiRerankModel = (typeof RERANK_MODELS)[RerankProvider][number]['id']
/** Subscription models are discovered for the connected account, never hardcoded. */
export type RerankModel = string
export type RerankAuthMode = 'api-key' | 'chatgpt'
export interface RerankConfig { provider: RerankProvider; model: RerankModel; authMode?: RerankAuthMode }

export const PROVIDER_LABELS = { anthropic: 'Anthropic', openai: 'OpenAI' } as const
export const DEFAULT_RERANK_MODELS = { anthropic: 'claude-sonnet-5', openai: 'gpt-4o-mini' } as const
export const DEFAULT_RERANK_CONFIG: RerankConfig = { provider: 'anthropic', model: DEFAULT_RERANK_MODELS.anthropic }
export const RERANK_CONSENT_VERSION = 'ai-rerank-v2'

export function isChatGptModelId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)
}

export function isChatGptConfig(config: { authMode?: string }): boolean {
  return config.authMode === 'chatgpt'
}

export function isRerankConfig(value: { provider: string; model: string; authMode?: string }): value is RerankConfig {
  if (isChatGptConfig(value)) {
    // An empty model represents a connection not yet configured in Settings.
    // The send boundary separately requires an available authenticated model.
    return value.provider === 'openai' && (value.model === '' || isChatGptModelId(value.model))
  }
  return (value.authMode === undefined || value.authMode === 'api-key') &&
    (value.provider === 'anthropic' || value.provider === 'openai') &&
    RERANK_MODELS[value.provider].some((model) => model.id === value.model)
}

export function rerankModelLabel(model: RerankModel): string {
  return [...RERANK_MODELS.anthropic, ...RERANK_MODELS.openai].find((entry) => entry.id === model)?.label ?? model
}

export function sameRerankConfig(a: RerankConfig, b: RerankConfig): boolean {
  return a.provider === b.provider && a.model === b.model && (a.authMode ?? 'api-key') === (b.authMode ?? 'api-key')
}

export function rerankProviderLabel(config: RerankConfig): 'Anthropic' | 'OpenAI' | 'ChatGPT' {
  return isChatGptConfig(config) ? 'ChatGPT' : PROVIDER_LABELS[config.provider]
}

/** A provider/model change requires reviewing that destination before its first send. */
export function rerankConsentKey(config: RerankConfig): string {
  if (isChatGptConfig(config)) return `rerankConsent:chatgpt:${config.model}`
  return `rerankConsent:${config.provider}:${config.model}`
}
