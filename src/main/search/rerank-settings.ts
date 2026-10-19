import {
  DEFAULT_RERANK_CONFIG,
  DEFAULT_RERANK_MODELS,
  RERANK_MODELS,
  RERANK_CONSENT_VERSION,
  isChatGptConfig,
  isChatGptModelId,
  isRerankConfig,
  rerankConsentKey,
  type RerankConfig,
  type RerankModel,
  type RerankProvider
} from '../../shared/rerank.js'
import { getDb, getSetting, setSetting } from '../db/index.js'
import { hasApiKey } from '../secrets.js'
import { getChatGptStatus, getChatGptCredentialRevision } from '../chatgpt/index.js'

export const RERANK_ENABLED_KEY = 'rerankEnabled'
const PROVIDER_KEY = 'rerankProvider'
const AUTH_MODE_KEY = 'rerankAuthMode:openai'
const CHATGPT_MODEL_KEY = 'rerankModel:chatgpt'
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
  if (provider === 'openai' && getSetting(AUTH_MODE_KEY) === 'chatgpt') {
    return { provider, model: getChatGptModel(), authMode: 'chatgpt' }
  }
  return { provider, model: getRerankModels()[provider] }
}

export function getChatGptModel(): string {
  const stored = getSetting(CHATGPT_MODEL_KEY)
  const models = getChatGptStatus().models
  if (stored && isChatGptModelId(stored) && (!models.length || models.some((model) => model.id === stored))) return stored
  return models[0]?.id ?? ''
}

/** Checks public metadata only; opening Settings must never unlock the keychain. */
export function hasRerankCredential(config: RerankConfig): boolean {
  if (!isChatGptConfig(config)) return hasApiKey(config.provider)
  const status = getChatGptStatus()
  return status.accounts.some((account) => account.id === status.activeAccountId && account.connected && account.planUsageEnabled) &&
    status.models.some((model) => model.id === config.model)
}

/** Plan approval belongs to a logical account connection, not a rotating token. */
export function rerankConsentValue(config: RerankConfig): string {
  return isChatGptConfig(config)
    ? `${RERANK_CONSENT_VERSION}:${getChatGptCredentialRevision()}`
    : RERANK_CONSENT_VERSION
}

/** Write the provider and its remembered model together, never mismatched pairs. */
export function setRerankConfig(config: RerankConfig): void {
  if (!isRerankConfig(config)) throw new Error('Choose a supported model for this AI provider.')
  getDb().transaction(() => {
    setSetting(PROVIDER_KEY, config.provider)
    if (config.provider === 'openai') setSetting(AUTH_MODE_KEY, config.authMode ?? 'api-key')
    setSetting(isChatGptConfig(config) ? CHATGPT_MODEL_KEY : modelKey(config.provider), config.model)
    // A saved preference or key never turns network access on automatically.
    if (!hasRerankCredential(config)) setSetting(RERANK_ENABLED_KEY, 'false')
  })()
}

/** Credential replacement/removal invalidates only this provider's accepted notices. */
export function clearProviderRerankConsent(provider: RerankProvider): void {
  for (const model of RERANK_MODELS[provider]) {
    setSetting(rerankConsentKey({ provider, model: model.id }), null)
  }
  if (provider === 'anthropic') setSetting('claudeRerankConsent', null)
}
