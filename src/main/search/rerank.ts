/** Optional remote ordering: the chosen provider sees only the reviewed payload. */
import Anthropic from '@anthropic-ai/sdk'
import type { MatchResult } from '@shared/types.js'
import { DEFAULT_RERANK_CONFIG, isChatGptConfig, rerankProviderLabel, type RerankConfig } from '@shared/rerank.js'
import { mergeRerankedResults } from './rerankOrder.js'
import { prepareRerank, RankingSchema, requestCandidateIndex, RERANK_LIMIT, type ClaudeRanking } from './rerankPrivacy.js'

interface RerankOptions {
  apiKey: string
  jobDescription: string
  results: MatchResult[]
  config?: RerankConfig
  /** Cancels plan usage when its account/session changes or signs out. */
  signal?: AbortSignal
}

const REQUEST_TIMEOUT_MS = 90_000
const RESPONSE_LIMIT_BYTES = 1024 * 1024
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const INVALID_RANKING = 'The model did not return a usable ranking.'
const INCOMPLETE_RANKING = 'The model did not finish the ranking. The local ranking is unchanged.'
const REFUSED_RANKING = 'The model declined to rerank these candidates. The local ranking is unchanged.'

// Environment settings must never redirect keys/evidence or turn on SDK logs.
const ANTHROPIC_CLIENT_POLICY = {
  baseURL: 'https://api.anthropic.com',
  logLevel: 'off' as const,
  authToken: null,
  fetchOptions: { redirect: 'error' as const },
  maxRetries: 0,
  timeout: REQUEST_TIMEOUT_MS
}

class SafeRerankError extends Error {}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Never forward a provider body or network exception: either may echo inputs. */
function transportError(config: RerankConfig, failure: unknown): SafeRerankError {
  if (failure instanceof SafeRerankError) return failure
  const name = rerankProviderLabel(config)
  const detail = object(failure)
  const status = typeof detail?.status === 'number' ? detail.status : null
  if (isChatGptConfig(config)) {
    const known = chatgptError(detail)
    if (known) return known
    if (status === 401) return new SafeRerankError('ChatGPT did not authorize this request. Check your connection and plan permissions in Settings. The local ranking is unchanged.')
    if (status === 403) return new SafeRerankError('Your ChatGPT plan has not authorized this request. Check your connection and plan permissions in Settings.')
    if (status === 404) return new SafeRerankError('This model is not available for your ChatGPT account. Refresh the models or choose another model in Settings.')
    if (status === 429) return new SafeRerankError('ChatGPT is limiting this request. Check your plan usage in ChatGPT and try again. The local ranking is unchanged.')
  }
  if (status === 401) return new SafeRerankError(`The ${name} API key was not accepted. Update it in Settings.`)
  if (status === 403) return new SafeRerankError(`${name} denied access to this model. Check your API key permissions or choose another model.`)
  if (status === 404) return new SafeRerankError(`The selected ${name} model is not available for this API key. Choose another model in Settings.`)
  if (status === 429) return new SafeRerankError(`${name} is rate limiting this request or the account has no remaining API credits. Check your API usage and try again.`)
  if (status === 400 || status === 422) return new SafeRerankError(`${name} could not accept this rerank request. Check the selected model and try again.`)
  if (status !== null && status >= 500) return new SafeRerankError(`${name} is temporarily unavailable. Try again later.`)
  if (detail?.name === 'TimeoutError' || detail?.name === 'AbortError' || detail?.name === 'APIConnectionTimeoutError') return new SafeRerankError(`The ${name} rerank request timed out. Try again.`)
  return new SafeRerankError(`The ${name} rerank request failed. Check your connection and try again.`)
}

/** Only documented error codes can influence text shown outside the main process. */
function chatgptError(value: unknown): SafeRerankError | null {
  const detail = object(value)
  const code = object(detail?.error)?.code ?? detail?.code
  if (code === 'subscription_sharing_usage_limit_exceeded') return new SafeRerankError('Your ChatGPT plan has reached its usage limit. Manage usage in ChatGPT, then try again. The local ranking is unchanged.')
  if (code === 'subscription_sharing_usage_unavailable') return new SafeRerankError('ChatGPT plan usage is currently unavailable for this connection. Check your plan permissions in ChatGPT and try again. The local ranking is unchanged.')
  if (code === 'subscription_sharing_user_not_eligible') return new SafeRerankError('This ChatGPT account is not eligible to use its plan with Qumaa. Check your plan eligibility in ChatGPT. The local ranking is unchanged.')
  if (code === 'subscription_sharing_unsupported_capability' || code === 'subscription_sharing_route_not_supported') return new SafeRerankError('This request is not supported by ChatGPT plan usage. Choose another model in Settings or try again after updating Qumaa.')
  if (code === 'subscription_sharing_invalid_user' || code === 'chatpass_v2_scope_not_authorized' || code === 'chatpass_v2_invalid_authorization_context') return new SafeRerankError('ChatGPT could not authorize this account for plan usage. Check the account and plan permissions in Settings. The local ranking is unchanged.')
  if (code === 'subscription_sharing_user_unavailable') return new SafeRerankError('ChatGPT could not check this account right now. Try again later. The local ranking is unchanged.')
  return null
}

function parseRanking(text: string): ClaudeRanking {
  try {
    const parsed = RankingSchema.safeParse(JSON.parse(text))
    if (parsed.success) return parsed.data.ranking
  } catch { /* JSON syntax errors must not echo the returned candidate text. */ }
  throw new SafeRerankError(INVALID_RANKING)
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (declaredLength > RESPONSE_LIMIT_BYTES) {
    await response.body?.cancel().catch(() => {})
    throw new SafeRerankError(INVALID_RANKING)
  }
  if (!response.body) throw new SafeRerankError(INVALID_RANKING)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > RESPONSE_LIMIT_BYTES) {
        await reader.cancel().catch(() => {})
        throw new SafeRerankError(INVALID_RANKING)
      }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')) as unknown }
  catch { throw new SafeRerankError(INVALID_RANKING) }
}

function openaiRanking(value: unknown): ClaudeRanking {
  const response = object(value)
  if (!response || response.status !== 'completed' || response.error !== undefined && response.error !== null || response.incomplete_details !== undefined && response.incomplete_details !== null) throw new SafeRerankError(INCOMPLETE_RANKING)
  if (!Array.isArray(response.output)) throw new SafeRerankError(INVALID_RANKING)
  const texts: string[] = []
  for (const item of response.output) {
    const message = object(item)
    if (message?.type !== 'message') continue
    if (!Array.isArray(message.content)) throw new SafeRerankError(INVALID_RANKING)
    for (const block of message.content) {
      const content = object(block)
      // Check every message block before parsing, including those after text.
      if (content?.type === 'refusal') throw new SafeRerankError(REFUSED_RANKING)
      if (content?.type === 'output_text') {
        if (typeof content.text !== 'string') throw new SafeRerankError(INVALID_RANKING)
        texts.push(content.text)
      }
    }
  }
  if (texts.length === 0) throw new SafeRerankError(INVALID_RANKING)
  return parseRanking(texts.join(''))
}

/**
 * Plan-backed requests require SSE. Deltas are never a successful ranking:
 * usage or authorization can fail after text has already arrived. Accept only
 * a complete, validated response.completed event, and bound the entire stream.
 */
async function streamedOpenaiRanking(response: Response, signal: AbortSignal): Promise<ClaudeRanking> {
  if (Number(response.headers.get('content-length')) > RESPONSE_LIMIT_BYTES ||
      response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'text/event-stream') {
    await response.body?.cancel().catch(() => {})
    throw new SafeRerankError(INVALID_RANKING)
  }
  if (!response.body) throw new SafeRerankError(INCOMPLETE_RANKING)
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let line = ''
  let skipLf = false
  let eventType = ''
  let data: string[] = []

  function dispatchLine(): ClaudeRanking | null {
    const current = line
    line = ''
    if (current === '') {
      const payload = data.join('\n')
      const declaredType = eventType
      data = []
      eventType = ''
      if (!payload) return null
      if (payload === '[DONE]') throw new SafeRerankError(INCOMPLETE_RANKING)
      let event: Record<string, unknown> | null
      try { event = object(JSON.parse(payload)) }
      catch { throw new SafeRerankError(INVALID_RANKING) }
      if (!event || typeof event.type !== 'string' || declaredType && declaredType !== event.type) throw new SafeRerankError(INVALID_RANKING)
      if (event.type === 'response.completed') return openaiRanking(event.response)
      if (event.type === 'response.failed') throw chatgptError(object(event.response)?.error) ?? new SafeRerankError(INCOMPLETE_RANKING)
      if (event.type === 'response.incomplete' || event.type === 'response.cancelled') throw new SafeRerankError(INCOMPLETE_RANKING)
      if (event.type === 'error') throw chatgptError(event) ?? new SafeRerankError(INCOMPLETE_RANKING)
      return null
    }
    if (current.startsWith(':')) return null
    const separator = current.indexOf(':')
    const field = separator === -1 ? current : current.slice(0, separator)
    const value = separator === -1 ? '' : current.slice(separator + 1).replace(/^ /, '')
    if (field === 'data') data.push(value)
    else if (field === 'event') eventType = value
    return null
  }

  function processText(text: string): ClaudeRanking | null {
    for (const character of text) {
      if (skipLf) {
        skipLf = false
        if (character === '\n') continue
      }
      if (character === '\r' || character === '\n') {
        skipLf = character === '\r'
        const ranking = dispatchLine()
        if (ranking) return ranking
      } else line += character
    }
    return null
  }

  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    while (true) {
      const next = await reader.read()
      signal.throwIfAborted()
      if (next.done) break
      size += next.value.byteLength
      if (size > RESPONSE_LIMIT_BYTES) throw new SafeRerankError(INVALID_RANKING)
      const ranking = processText(decoder.decode(next.value, { stream: true }))
      if (ranking) return ranking
    }
    // A trailing event without its separator is an interrupted stream.
    processText(decoder.decode())
    throw new SafeRerankError(INCOMPLETE_RANKING)
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Each invocation sends once to exactly one provider; errors preserve local work. */
export async function rerank(opts: RerankOptions): Promise<MatchResult[]> {
  if (opts.results.length <= 1) return opts.results
  const config = opts.config ?? DEFAULT_RERANK_CONFIG
  const prepared = prepareRerank(opts.jobDescription, opts.results, config)
  let ranking: ClaudeRanking
  try {
    opts.signal?.throwIfAborted()
    if (prepared.provider === 'anthropic') {
      const client = new Anthropic({ apiKey: opts.apiKey, ...ANTHROPIC_CLIENT_POLICY })
      // create lets us reject truncation/refusal before attempting JSON parsing.
      const response = await client.messages.create(prepared.sdkRequest, {
        // Per-request headers are merged after SDK environment custom headers.
        headers: { Authorization: null, 'X-Api-Key': opts.apiKey },
        ...(opts.signal ? { signal: opts.signal } : {})
      })
      if (response.stop_reason === 'refusal') throw new SafeRerankError(REFUSED_RANKING)
      if (response.stop_reason !== 'end_turn') throw new SafeRerankError(INCOMPLETE_RANKING)
      ranking = parseRanking(response.content.filter((block) => block.type === 'text').map((block) => block.text).join(''))
    } else {
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(prepared.preview.requestBody),
        redirect: 'error',
        signal
      })
      if (!response.ok) {
        let error: unknown
        if (isChatGptConfig(config)) {
          try { error = object(await boundedJson(response))?.error } catch { /* Discard untrusted or oversized error bodies. */ }
        } else await response.body?.cancel().catch(() => {})
        throw transportError(config, { status: response.status, error })
      }
      ranking = isChatGptConfig(config)
        ? await streamedOpenaiRanking(response, signal)
        : openaiRanking(await boundedJson(response))
    }
    opts.signal?.throwIfAborted()
  } catch (failure) {
    if (opts.signal?.aborted) throw new SafeRerankError(`The ${rerankProviderLabel(config)} rerank request was cancelled. The local ranking is unchanged.`)
    throw transportError(config, failure)
  }

  const localRanking = ranking.flatMap((entry) => {
    const index = requestCandidateIndex(entry.id)
    return index === null || index >= Math.min(opts.results.length, RERANK_LIMIT) ? [] : [{ ...entry, id: index }]
  })
  if (localRanking.length === 0) throw new SafeRerankError(INVALID_RANKING)
  // A second model's omitted candidates must not inherit the first model's reasons.
  const localResults = opts.results.map(({ llmReason: _previousReason, ...result }) => result)
  return mergeRerankedResults(localResults, localRanking, RERANK_LIMIT)
}
