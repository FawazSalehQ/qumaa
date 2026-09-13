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
export type RerankModel = (typeof RERANK_MODELS)[RerankProvider][number]['id']
export interface RerankConfig { provider: RerankProvider; model: RerankModel }

export const PROVIDER_LABELS = { anthropic: 'Anthropic', openai: 'OpenAI' } as const
export const DEFAULT_RERANK_MODELS = { anthropic: 'claude-sonnet-5', openai: 'gpt-4o-mini' } as const
export const DEFAULT_RERANK_CONFIG: RerankConfig = { provider: 'anthropic', model: DEFAULT_RERANK_MODELS.anthropic }
export const RERANK_CONSENT_VERSION = 'ai-rerank-v2'

export function isRerankConfig(value: { provider: string; model: string }): value is RerankConfig {
  return (value.provider === 'anthropic' || value.provider === 'openai') &&
    RERANK_MODELS[value.provider].some((model) => model.id === value.model)
}

export function rerankModelLabel(model: RerankModel): string {
  return [...RERANK_MODELS.anthropic, ...RERANK_MODELS.openai].find((entry) => entry.id === model)!.label
}

/** A provider/model change requires reviewing that destination before its first send. */
export function rerankConsentKey(config: RerankConfig): string {
  return `rerankConsent:${config.provider}:${config.model}`
}
