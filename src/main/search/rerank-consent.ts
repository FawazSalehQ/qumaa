/** Shared preview and native consent flow for every outbound AI request. */
import { dialog, type BrowserWindow } from 'electron'
import type { ClaudeRerankReview, MatchResult } from '@shared/types.js'
import { getSetting, setSetting } from '../db/index.js'
import { nativeText as t } from '../language.js'
import { maintenance } from '../maintenance.js'
import { getApiKey, getApiKeyRevision } from '../secrets.js'
import { beginChatGptRequest, getChatGptAccessToken, getChatGptCredentialRevision, getChatGptStatus } from '../chatgpt/index.js'
import { rerank } from './rerank.js'
import { buildRerankPreview } from './rerankPrivacy.js'
import { searchSessions } from './sessions.js'
import { getRerankConfig, hasRerankCredential, rerankConsentValue } from './rerank-settings.js'
import { isChatGptConfig, rerankProviderLabel, sameRerankConfig, rerankConsentKey, rerankModelLabel, type RerankConfig } from '@shared/rerank.js'

type Source = ReturnType<typeof searchSessions.get>
function requireEnabled(): RerankConfig {
  const config = getRerankConfig()
  if (!hasRerankCredential(config)) throw new Error(isChatGptConfig(config)
    ? 'Connect a ChatGPT account with plan access and choose an available model in Settings.'
    : 'No API key is configured.')
  if (getSetting('rerankEnabled') !== 'true') throw new Error('Reranking is not enabled.')
  return config
}

function credentialRevision(config: RerankConfig): string {
  return isChatGptConfig(config) ? getChatGptCredentialRevision() : getApiKeyRevision(config.provider)
}

function authContext(config: RerankConfig): string {
  return JSON.stringify([config.provider, config.authMode ?? 'api-key', credentialRevision(config)])
}

function accountLabel(config: RerankConfig): string | undefined {
  if (!isChatGptConfig(config)) return undefined
  const status = getChatGptStatus()
  return status.accounts.find((account) => account.id === status.activeAccountId)?.label
}

export function previewRerankSession(source: Source): ClaudeRerankReview {
  const config = requireEnabled()
  const preview = buildRerankPreview(source.jobDescription, source.response.results, config)
  const label = accountLabel(config)
  if (label) preview.accountLabel = label
  return {
    preview,
    consentRequired: preview.candidateCount > 1 && getSetting(rerankConsentKey(config)) !== rerankConsentValue(config),
    approvalToken: searchSessions.issueApproval(source.id, preview.requestBody, authContext(config))
  }
}

/** Callers resolve and validate their source before approval, sending, and saving. */
export async function rerankWithConfirmation<T>(
  args: { sessionId: string; approvalToken?: string },
  getWindow: () => BrowserWindow,
  readSource: () => Source,
  complete: (results: MatchResult[], config: RerankConfig) => T
): Promise<T> {
  const approved = await maintenance.runOperation(() => {
    const config = requireEnabled()
    const source = readSource()
    const prepared = buildRerankPreview(source.jobDescription, source.response.results, config)
    searchSessions.consumeApproval(args.approvalToken, args.sessionId, prepared.requestBody, authContext(config))
    return {
      config,
      requestBody: JSON.stringify(prepared.requestBody),
      credentialRevision: credentialRevision(config),
      accountLabel: accountLabel(config),
      approvalRevision: searchSessions.getApprovalRevision(),
      consentRequired: prepared.candidateCount > 1 && getSetting(rerankConsentKey(config)) !== rerankConsentValue(config)
    }
  })

  const requireUnchanged = (): Source => {
    const config = requireEnabled()
    if (!sameRerankConfig(config, approved.config) ||
        credentialRevision(config) !== approved.credentialRevision ||
        searchSessions.getApprovalRevision() !== approved.approvalRevision) {
      throw new Error('The AI provider, model, or sharing settings changed. Review the request again.')
    }
    const source = readSource()
    if (JSON.stringify(buildRerankPreview(source.jobDescription, source.response.results, config).requestBody) !== approved.requestBody) {
      throw new Error('The approved AI request changed. Review the request again.')
    }
    return source
  }
  const provider = rerankProviderLabel(approved.config)
  const model = rerankModelLabel(approved.config.model)

  const { response } = await dialog.showMessageBox(getWindow(), {
    type: 'question',
    buttons: [t('Cancel'), t('Send to {provider}', { provider })],
    defaultId: 0,
    cancelId: 0,
    message: t('Send this search’s reviewed evidence to {provider} using {model}?', { provider, model }),
    detail: (isChatGptConfig(approved.config)
      ? t('Using the ChatGPT plan for {account}. This uses that account’s allowance; API billing is separate.', { account: approved.accountLabel ?? 'ChatGPT' }) + '\n\n'
      : '') + (approved.consentRequired
      ? t('This approves the displayed data policy for this provider and model. Standard matching remains on this device.')
      : t('Qumaa requires this operating-system confirmation for every outbound rerank.'))
  })
  if (response !== 1) throw new Error('AI reranking was cancelled.')

  return maintenance.runOperation(async () => {
    const source = requireUnchanged()
    const request = isChatGptConfig(approved.config) ? beginChatGptRequest() : undefined
    try {
      const apiKey = isChatGptConfig(approved.config)
        ? await getChatGptAccessToken()
        : getApiKey(approved.config.provider)
      if (!apiKey) throw new Error('Protected credential storage could not unlock the API key.')
      // Refresh may await the network. Do not send if the account or source changed meanwhile.
      requireUnchanged()
      if (approved.consentRequired) setSetting(rerankConsentKey(approved.config), rerankConsentValue(approved.config))
      const ordered = await rerank({ apiKey, jobDescription: source.jobDescription, results: source.response.results, config: approved.config,
        ...(request ? { signal: request.signal } : {}) })
      // Imports, edits or another refresh may have completed during the network call.
      requireUnchanged()
      return complete(ordered, approved.config)
    } finally { request?.dispose() }
  })
}
