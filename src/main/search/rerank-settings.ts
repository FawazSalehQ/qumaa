import {
  DEFAULT_RERANK_CONFIG,
  DEFAULT_RERANK_MODELS,
  RERANK_MODELS,
  isRerankConfig,
  rerankConsentKey,
  type RerankConfig,
  type RerankModel,
  type RerankProvider
} from '../../shared/rerank.js'
import { getDb, getSetting, setSetting } from '../db/index.js'
import { hasApiKey } from '../secrets.js'

export const RERANK_ENABLED_KEY = 'rerankEnabled'
const PROVIDER_KEY = 'rerankProvider'
const modelKey = (provider: RerankProvider): string => `rerankModel:${provider}`

/** Validate stored choices as well as IPC input; old installs default to Anthropic. */
export function getRerankModels(): Record<RerankProvider, RerankModel> {
  const models: Record<RerankProvider, RerankModel> = { ...DEFAULT_RERANK_MODELS }
  for (const provider of ['anthropic', 'openai'] as const) {
    const model = getSetting(modelKey(provider))
    const candidate = { provider, model: model ?? '' }
    if (isRerankConfig(candidate)) models[provider] = candidate.model
  }
  return models
}

export function getRerankConfig(): RerankConfig {
  const stored = getSetting(PROVIDER_KEY)
  const provider = stored === 'anthropic' || stored === 'openai'
    ? stored
    : DEFAULT_RERANK_CONFIG.provider
  return { provider, model: getRerankModels()[provider] }
}

/** Write the provider and its remembered model together, never mismatched pairs. */
export function setRerankConfig(config: RerankConfig): void {
  if (!isRerankConfig(config)) throw new Error('Choose a supported model for this AI provider.')
  getDb().transaction(() => {
    setSetting(PROVIDER_KEY, config.provider)
    setSetting(modelKey(config.provider), config.model)
    // A saved preference or key never turns network access on automatically.
    if (!hasApiKey(config.provider)) setSetting(RERANK_ENABLED_KEY, 'false')
  })()
}

/** Credential replacement/removal invalidates only this provider's accepted notices. */
export function clearProviderRerankConsent(provider: RerankProvider): void {
  for (const model of RERANK_MODELS[provider]) {
    setSetting(rerankConsentKey({ provider, model: model.id }), null)
  }
  if (provider === 'anthropic') setSetting('claudeRerankConsent', null)
}
