/** Optional remote ordering: the chosen provider sees only the reviewed payload. */
import Anthropic from '@anthropic-ai/sdk'
import type { MatchResult } from '@shared/types.js'
import { DEFAULT_RERANK_CONFIG, PROVIDER_LABELS, type RerankConfig, type RerankProvider } from '@shared/rerank.js'
import { mergeRerankedResults } from './rerankOrder.js'
import { prepareRerank, RankingSchema, requestCandidateIndex, RERANK_LIMIT, type ClaudeRanking } from './rerankPrivacy.js'

interface RerankOptions {
  apiKey: string
  jobDescription: string
  results: MatchResult[]
  config?: RerankConfig
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
function transportError(provider: RerankProvider, failure: unknown): SafeRerankError {
  if (failure instanceof SafeRerankError) return failure
  const name = PROVIDER_LABELS[provider]
  const detail = object(failure)
  const status = typeof detail?.status === 'number' ? detail.status : null
  if (status === 401) return new SafeRerankError(`The ${name} API key was not accepted. Update it in Settings.`)
  if (status === 403) return new SafeRerankError(`${name} denied access to this model. Check your API key permissions or choose another model.`)
  if (status === 404) return new SafeRerankError(`The selected ${name} model is not available for this API key. Choose another model in Settings.`)
  if (status === 429) return new SafeRerankError(`${name} is rate limiting this request or the account has no remaining API credits. Check your API usage and try again.`)
  if (status === 400 || status === 422) return new SafeRerankError(`${name} could not accept this rerank request. Check the selected model and try again.`)
  if (status !== null && status >= 500) return new SafeRerankError(`${name} is temporarily unavailable. Try again later.`)
  if (detail?.name === 'TimeoutError' || detail?.name === 'AbortError' || detail?.name === 'APIConnectionTimeoutError') return new SafeRerankError(`The ${name} rerank request timed out. Try again.`)
  return new SafeRerankError(`The ${name} rerank request failed. Check your connection and try again.`)
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

/** Each invocation sends once to exactly one provider; errors preserve local work. */
export async function rerank(opts: RerankOptions): Promise<MatchResult[]> {
  if (opts.results.length <= 1) return opts.results
  const config = opts.config ?? DEFAULT_RERANK_CONFIG
  const prepared = prepareRerank(opts.jobDescription, opts.results, config)
  let ranking: ClaudeRanking
  try {
    if (prepared.provider === 'anthropic') {
      const client = new Anthropic({ apiKey: opts.apiKey, ...ANTHROPIC_CLIENT_POLICY })
      // create lets us reject truncation/refusal before attempting JSON parsing.
      const response = await client.messages.create(prepared.sdkRequest, {
        // Per-request headers are merged after SDK environment custom headers.
        headers: { Authorization: null, 'X-Api-Key': opts.apiKey }
      })
      if (response.stop_reason === 'refusal') throw new SafeRerankError(REFUSED_RANKING)
      if (response.stop_reason !== 'end_turn') throw new SafeRerankError(INCOMPLETE_RANKING)
      ranking = parseRanking(response.content.filter((block) => block.type === 'text').map((block) => block.text).join(''))
    } else {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(prepared.preview.requestBody),
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw transportError('openai', { status: response.status })
      }
      ranking = openaiRanking(await boundedJson(response))
    }
  } catch (failure) { throw transportError(config.provider, failure) }

  const localRanking = ranking.flatMap((entry) => {
    const index = requestCandidateIndex(entry.id)
    return index === null || index >= Math.min(opts.results.length, RERANK_LIMIT) ? [] : [{ ...entry, id: index }]
  })
  if (localRanking.length === 0) throw new SafeRerankError(INVALID_RANKING)
  // A second model's omitted candidates must not inherit the first model's reasons.
  const localResults = opts.results.map(({ llmReason: _previousReason, ...result }) => result)
  return mergeRerankedResults(localResults, localRanking, RERANK_LIMIT)
}
