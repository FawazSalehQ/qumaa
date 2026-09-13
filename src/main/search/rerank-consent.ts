/** Shared preview and native consent flow for every outbound AI request. */
import { dialog, type BrowserWindow } from 'electron'
import type { ClaudeRerankReview, MatchResult } from '@shared/types.js'
import { getSetting, setSetting } from '../db/index.js'
import { nativeText as t } from '../language.js'
import { maintenance } from '../maintenance.js'
import { getApiKey, getApiKeyRevision, hasApiKey } from '../secrets.js'
import { rerank } from './rerank.js'
import { buildRerankPreview } from './rerankPrivacy.js'
import { searchSessions } from './sessions.js'
import { getRerankConfig } from './rerank-settings.js'
import { PROVIDER_LABELS, RERANK_CONSENT_VERSION, rerankConsentKey, rerankModelLabel, type RerankConfig } from '@shared/rerank.js'

type Source = ReturnType<typeof searchSessions.get>
function requireEnabled(): RerankConfig {
  const config = getRerankConfig()
  if (!hasApiKey(config.provider)) throw new Error('No API key is configured.')
  if (getSetting('rerankEnabled') !== 'true') throw new Error('Reranking is not enabled.')
  return config
}

export function previewRerankSession(source: Source): ClaudeRerankReview {
  const config = requireEnabled()
  const preview = buildRerankPreview(source.jobDescription, source.response.results, config)
  return {
    preview,
    consentRequired: preview.candidateCount > 1 && getSetting(rerankConsentKey(config)) !== RERANK_CONSENT_VERSION,
    approvalToken: searchSessions.issueApproval(source.id, preview.requestBody)
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
    searchSessions.consumeApproval(args.approvalToken, args.sessionId, prepared.requestBody)
    return {
      config,
      requestBody: JSON.stringify(prepared.requestBody),
      credentialRevision: getApiKeyRevision(config.provider),
      approvalRevision: searchSessions.getApprovalRevision(),
      consentRequired: prepared.candidateCount > 1 && getSetting(rerankConsentKey(config)) !== RERANK_CONSENT_VERSION
    }
  })

  const requireUnchanged = (): Source => {
    const config = requireEnabled()
    if (JSON.stringify(config) !== JSON.stringify(approved.config) ||
        getApiKeyRevision(config.provider) !== approved.credentialRevision ||
        searchSessions.getApprovalRevision() !== approved.approvalRevision) {
      throw new Error('The AI provider, model, or sharing settings changed. Review the request again.')
    }
    const source = readSource()
    if (JSON.stringify(buildRerankPreview(source.jobDescription, source.response.results, config).requestBody) !== approved.requestBody) {
      throw new Error('The approved AI request changed. Review the request again.')
    }
    return source
  }
  const provider = PROVIDER_LABELS[approved.config.provider]
  const model = rerankModelLabel(approved.config.model)

  const { response } = await dialog.showMessageBox(getWindow(), {
    type: 'question',
    buttons: [t('Cancel'), t('Send to {provider}', { provider })],
    defaultId: 0,
    cancelId: 0,
    message: t('Send this search’s reviewed evidence to {provider} using {model}?', { provider, model }),
    detail: approved.consentRequired
      ? t('This approves the displayed data policy for this provider and model. Standard matching remains on this device.')
      : t('Qumaa requires this operating-system confirmation for every outbound rerank.')
  })
  if (response !== 1) throw new Error('AI reranking was cancelled.')

  return maintenance.runOperation(async () => {
    const source = requireUnchanged()
    const apiKey = getApiKey(approved.config.provider)
    if (!apiKey) throw new Error('Protected credential storage could not unlock the API key.')
    if (approved.consentRequired) setSetting(rerankConsentKey(approved.config), RERANK_CONSENT_VERSION)
    const ordered = await rerank({ apiKey, jobDescription: source.jobDescription, results: source.response.results, config: approved.config })
    // Imports, edits or another refresh may have completed during the network call.
    requireUnchanged()
    return complete(ordered, approved.config)
  })
}
