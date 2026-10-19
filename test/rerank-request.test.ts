import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MatchResult } from '../src/shared/types.js'
import { RERANK_MODELS, type RerankConfig } from '../src/shared/rerank.js'

const mocks = vi.hoisted(() => ({
  constructorOptions: undefined as unknown,
  create: vi.fn(),
  fetch: vi.fn()
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = { create: mocks.create }

    constructor(options: unknown) {
      mocks.constructorOptions = options
    }
  }
}))

import { rerank } from '../src/main/search/rerank.js'
import { buildRerankPreview } from '../src/main/search/rerankPrivacy.js'

function candidate(id: number, name: string): MatchResult {
  return {
    resume: {
      id,
      recordKey: id.toString(16).padStart(64, '0'),
      fileName: `${name}.pdf`,
      filePath: `/Users/private/${name}.pdf`,
      importedAt: id,
      name,
      email: `${name.toLowerCase()}@example.com`,
      phone: '+1 415 555 0123',
      location: 'San Francisco, CA',
      yearsExperience: id,
      educationLevel: 'bachelors',
      skills: ['TypeScript']
    },
    score: 1 - id / 100,
    breakdown: { semantic: 0.8, lexical: 0.6, skills: 1 },
    matchedSkills: ['TypeScript'],
    missingSkills: [],
    evidence: [
      {
        section: 'experience',
        similarity: 0.9,
        text: `${name} (${name.toLowerCase()}@example.com) led the migration in San Francisco, CA.`
      }
    ]
  }
}

beforeEach(() => {
  mocks.constructorOptions = undefined
  mocks.create.mockReset()
  mocks.fetch.mockReset()
  vi.stubGlobal('fetch', mocks.fetch)
})

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

const ranking = [
  { id: 'candidate-02', rank: 1, reason: 'Led the more relevant migration.' },
  { id: 'candidate-01', rank: 2, reason: 'Relevant TypeScript experience.' }
]
function anthropicResponse(entries = ranking) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ranking: entries }) }] }
}
function openaiResponse(entries = ranking) {
  return { status: 'completed', error: null, output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ ranking: entries }) }] }
  ] }
}

function sseEvent(type: string, fields: Record<string, unknown> = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`
}

function eventResponse(text: string, chunkSize = 4096, cancel = vi.fn(), close = true): Response {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset < bytes.length) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize))
        offset += chunkSize
      } else if (close) controller.close()
    },
    cancel
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
}

describe('Claude rerank request', () => {
  it('sends exactly the previewed body and maps opaque ids back to local ordering', async () => {
    const results = [candidate(1, 'Alice Private'), candidate(2, 'Bob Private')]
    const preview = buildRerankPreview('Platform engineer', results)
    mocks.create.mockResolvedValue(anthropicResponse())

    const ordered = await rerank({
      apiKey: 'sk-ant-api03-test-only',
      jobDescription: 'Platform engineer',
      results
    })

    expect(mocks.constructorOptions).toEqual({
      apiKey: 'sk-ant-api03-test-only',
      baseURL: 'https://api.anthropic.com',
      logLevel: 'off',
      authToken: null,
      fetchOptions: { redirect: 'error' },
      timeout: 90_000,
      maxRetries: 0
    })
    const capturedBody = JSON.parse(JSON.stringify(mocks.create.mock.calls[0][0]))
    expect(capturedBody).toEqual(preview.requestBody)
    expect(JSON.parse(capturedBody.messages[0].content).jobPosting).toBe('Platform engineer')
    const serialized = JSON.stringify(capturedBody)
    expect(serialized).not.toContain('Alice Private')
    expect(serialized).not.toContain('Bob Private')
    expect(serialized).not.toContain('alice private@example.com')
    expect(serialized).not.toContain('/Users/private')
    expect(serialized).not.toContain('sk-ant-api03-test-only')
    expect(ordered.map((result) => result.resume.id)).toEqual([2, 1])
    expect(ordered[0].llmReason).toBe('Led the more relevant migration.')
  })

  it('ignores environment endpoint and logging overrides', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://attacker.invalid')
    vi.stubEnv('ANTHROPIC_LOG', 'debug')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'environment-token')
    vi.stubEnv('ANTHROPIC_CUSTOM_HEADERS', 'Authorization: Bearer environment-token\nX-Api-Key: environment-key')
    const results = [candidate(1, 'Alice'), candidate(2, 'Bob')]
    mocks.create.mockResolvedValue(anthropicResponse())

    await rerank({ apiKey: 'test', jobDescription: 'Engineer', results })

    expect(mocks.constructorOptions).toMatchObject({
      baseURL: 'https://api.anthropic.com',
      logLevel: 'off',
      authToken: null,
      fetchOptions: { redirect: 'error' }
    })
    expect(mocks.create.mock.calls[0][1]).toEqual({ headers: { Authorization: null, 'X-Api-Key': 'test' } })
  })

  it('ignores invented opaque ids and preserves omitted candidates locally', async () => {
    const results = [candidate(1, 'Alice'), candidate(2, 'Bob'), candidate(3, 'Carol')]
    mocks.create.mockResolvedValue(anthropicResponse([
      { id: 'candidate-03', rank: 1, reason: 'Most relevant.' },
      { id: 'candidate-99', rank: 2, reason: 'Invented.' }
    ]))

    const ordered = await rerank({ apiKey: 'test', jobDescription: 'Engineer', results })
    expect(ordered.map((result) => result.resume.id)).toEqual([3, 1, 2])
  })

  it('does not contact Anthropic for fewer than two candidates', async () => {
    const results = [candidate(1, 'Alice')]
    await expect(rerank({ apiKey: 'test', jobDescription: 'Engineer', results })).resolves.toBe(
      results
    )
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('selected provider transport', () => {
  const configs: RerankConfig[] = Object.entries(RERANK_MODELS).flatMap(([provider, models]) => models.map((model) => ({ provider: provider as RerankConfig['provider'], model: model.id })))

  it.each(configs)('sends only the reviewed body to $provider / $model', async (config) => {
    const results = [candidate(1, 'Alice Private'), candidate(2, 'Bob Private')]
    const preview = buildRerankPreview('Platform engineer', results, config)
    mocks.create.mockResolvedValue(anthropicResponse())
    mocks.fetch.mockResolvedValue(Response.json(openaiResponse()))
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const ordered = await rerank({ apiKey: 'synthetic-key-not-a-real-key', jobDescription: 'Platform engineer', results, config })

    if (config.provider === 'anthropic') {
      expect(mocks.create).toHaveBeenCalledTimes(1)
      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(JSON.parse(JSON.stringify(mocks.create.mock.calls[0][0]))).toEqual(preview.requestBody)
      expect(preview.requestBody).toMatchObject({ model: config.model, max_tokens: 8192, thinking: { type: 'adaptive', display: 'omitted' }, output_config: { effort: 'low' } })
    } else {
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const [url, request] = mocks.fetch.mock.calls[0]
      expect(url).toBe('https://api.openai.com/v1/responses')
      expect(request.headers).toEqual({ Authorization: 'Bearer synthetic-key-not-a-real-key', 'Content-Type': 'application/json' })
      expect(request.method).toBe('POST')
      expect(request.redirect).toBe('error')
      expect(request.signal).toBeInstanceOf(AbortSignal)
      expect(timeout).toHaveBeenCalledWith(90_000)
      expect(JSON.parse(request.body)).toEqual(preview.requestBody)
      expect(preview.requestBody).toMatchObject({ model: config.model, store: false, stream: false, max_output_tokens: config.model === 'gpt-4o-mini' ? 4096 : 8192 })
      if (config.model === 'gpt-4o-mini') expect(preview.requestBody).not.toHaveProperty('reasoning')
      else expect(preview.requestBody.reasoning).toEqual({ effort: 'low' })
    }
    const body = JSON.stringify(preview.requestBody)
    expect(body).not.toMatch(/Alice Private|Bob Private|\/Users\/private|synthetic-key|apiKey|Authorization/)
    expect(ordered.map((match) => match.resume.id)).toEqual([2, 1])
    expect(ordered[0].score).toBe(results[1].score)
    expect(ordered[0].llmReason).toBe(ranking[0].reason)
  })

  it.each(configs)('does not send a zero/one-candidate list to $provider / $model', async (config) => {
    for (const results of [[], [candidate(1, 'Alice')]]) {
      expect(await rerank({ apiKey: 'test', jobDescription: 'Engineer', results, config })).toBe(results)
    }
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('ignores OpenAI endpoint and logging environment settings', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://attacker.invalid')
    vi.stubEnv('OPENAI_LOG', 'debug')
    mocks.fetch.mockResolvedValue(Response.json(openaiResponse()))
    await rerank({ apiKey: 'test', jobDescription: 'Engineer', results: [candidate(1, 'Alice'), candidate(2, 'Bob')], config: { provider: 'openai', model: 'gpt-4o-mini' } })
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses')
    expect(mocks.fetch.mock.calls[0][1].redirect).toBe('error')
  })

  it.each(['anthropic', 'openai'] as const)('clears old reasons, keeps omitted candidates and the tail for %s', async (provider) => {
    const results = Array.from({ length: 17 }, (_, index) => ({ ...candidate(index + 1, `Person ${index}`), llmReason: 'Old provider explanation.' }))
    const partial = [{ id: 'candidate-15', rank: 1, reason: 'New provider explanation.' }, { id: 'candidate-99', rank: 2, reason: 'Invented candidate.' }]
    mocks.create.mockResolvedValue(anthropicResponse(partial))
    mocks.fetch.mockResolvedValue(Response.json(openaiResponse(partial)))
    const ordered = await rerank({ apiKey: 'test', jobDescription: 'Engineer', results, config: { provider, model: provider === 'anthropic' ? 'claude-opus-5' : 'gpt-6-astra' } })
    expect(ordered.map((match) => match.resume.id)).toEqual([15, ...Array.from({ length: 14 }, (_, i) => i + 1), 16, 17])
    expect(ordered[0].llmReason).toBe('New provider explanation.')
    expect(ordered.slice(1).every((match) => match.llmReason === undefined)).toBe(true)
    expect(results.every((match) => match.llmReason === 'Old provider explanation.')).toBe(true)
  })
})

describe('provider failures never expose data or change the local list', () => {
  const results = [candidate(1, 'Alice'), candidate(2, 'Bob')]
  const run = (provider: 'anthropic' | 'openai') => rerank({ apiKey: 'secret-key', jobDescription: 'Private job', results, config: { provider, model: provider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o-mini' } })

  it.each(['refusal', 'max_tokens', 'stop_sequence', 'pause_turn', null])('rejects Anthropic stop reason %s before parsing its body', async (stopReason) => {
    const content = vi.fn(() => { throw new Error('Body should not be parsed') })
    mocks.create.mockResolvedValue({ stop_reason: stopReason, get content() { return content() } })
    await expect(run('anthropic')).rejects.toThrow(stopReason === 'refusal' ? 'declined' : 'did not finish')
    expect(content).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it.each(['incomplete', 'failed', 'in_progress', 'cancelled'])('rejects OpenAI response status %s even with valid-looking text', async (status) => {
    mocks.fetch.mockResolvedValue(Response.json({ ...openaiResponse(), status }))
    await expect(run('openai')).rejects.toThrow('did not finish')
  })

  it('rejects an OpenAI refusal after otherwise valid output text', async () => {
    const response = openaiResponse()
    mocks.fetch.mockResolvedValue(Response.json({ ...response, output: [...response.output, { type: 'message', content: [{ type: 'refusal', refusal: 'Private refusal text' }] }] }))
    await expect(run('openai')).rejects.toThrow('declined to rerank')
  })

  it.each([{ error: { message: 'Private provider error' } }, { incomplete_details: { reason: 'max_output_tokens' } }, { output: [] }])('rejects unusable OpenAI response metadata %#', async (fields) => {
    mocks.fetch.mockResolvedValue(Response.json({ ...openaiResponse(), ...fields }))
    await expect(run('openai')).rejects.toThrow(/did not (finish|return)/)
  })

  it.each(['anthropic', 'openai'] as const)('does not expose invalid JSON or schema values from %s', async (provider) => {
    const privateText = '{"ranking":[{"id":"candidate-01","reason":"secret-key Private job Alice"}]}'
    mocks.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: privateText }] })
    mocks.fetch.mockResolvedValue(Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: privateText }] }] }))
    await expect(run(provider)).rejects.toThrow('The model did not return a usable ranking.')
  })

  it.each(['anthropic', 'openai'] as const)('rejects empty and wholly invented %s rankings', async (provider) => {
    for (const entries of [[], [{ id: 'candidate-99', rank: 1, reason: 'Invented.' }], [{ id: 'candidate-15', rank: 1, reason: 'Outside this two-candidate request.' }]]) {
      mocks.create.mockResolvedValue(anthropicResponse(entries))
      mocks.fetch.mockResolvedValue(Response.json(openaiResponse(entries)))
      await expect(run(provider)).rejects.toThrow('The model did not return a usable ranking.')
    }
  })

  it.each([401, 403, 404, 429, 400, 422, 503])('sanitizes HTTP %s for both providers without retrying', async (status) => {
    mocks.create.mockRejectedValue({ status, message: 'secret-key Private job Alice', error: { message: 'Private response body' } })
    mocks.fetch.mockResolvedValue(new Response('secret-key Private job Alice', { status }))
    for (const provider of ['anthropic', 'openai'] as const) {
      const failure = await run(provider).catch((error: Error) => error)
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toContain(provider === 'anthropic' ? 'Anthropic' : 'OpenAI')
      expect((failure as Error).message).not.toMatch(/secret-key|Private|Alice/)
    }
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['anthropic', 'openai'] as const)('sanitizes %s connection failures and timeouts', async (provider) => {
    for (const name of ['TypeError', 'TimeoutError', 'APIConnectionTimeoutError']) {
      const failure = Object.assign(new Error('secret-key Private job Alice'), { name })
      mocks.create.mockRejectedValue(failure)
      mocks.fetch.mockRejectedValue(failure)
      await expect(run(provider)).rejects.toThrow(name === 'TypeError' ? 'Check your connection' : 'timed out')
    }
  })

  it('rejects an oversized declared OpenAI body before reading it', async () => {
    mocks.fetch.mockResolvedValue(new Response('Private provider data', { headers: { 'content-length': String(1024 * 1024 + 1) } }))
    await expect(run('openai')).rejects.toThrow('did not return a usable ranking')
  })

  it('bounds OpenAI streaming reads without trusting Content-Length', async () => {
    const cancelled = vi.fn()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000))
        controller.enqueue(new Uint8Array(700_000))
      },
      cancel: cancelled
    })
    mocks.fetch.mockResolvedValue(new Response(stream))
    await expect(run('openai')).rejects.toThrow('did not return a usable ranking')
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('rejects unknown provider/model pairings before contacting either API', async () => {
    await expect(rerank({ apiKey: 'test', jobDescription: 'Engineer', results, config: { provider: 'openai', model: 'claude-opus-5' } })).rejects.toThrow('supported reranking provider and model')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('ChatGPT plan transport', () => {
  const config: RerankConfig = { provider: 'openai', model: 'gpt-account-catalog-model', authMode: 'chatgpt' }
  const results = [candidate(1, 'Alice Private'), candidate(2, 'Bob Private')]
  const run = () => rerank({ apiKey: 'private-oauth-access-token', jobDescription: 'Private job', results, config })

  it('does not send before an account model has been selected', async () => {
    await expect(rerank({ apiKey: 'test', jobDescription: 'Private job', results, config: { ...config, model: '' } })).rejects.toThrow('Choose a supported reranking provider and model')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('sends the exact plan preview once, with an OAuth bearer and no API fallback', async () => {
    const cancel = vi.fn()
    mocks.fetch.mockResolvedValue(eventResponse(
      sseEvent('response.created', { response: { status: 'in_progress' } }) +
      sseEvent('response.output_text.delta', { delta: 'Untrusted partial text, never used.' }) +
      sseEvent('response.completed', { response: openaiResponse() }),
      71, cancel, false
    ))
    const ordered = await run()
    const preview = buildRerankPreview('Private job', results, config)
    expect(preview).toMatchObject({ provider: 'ChatGPT', authMode: 'chatgpt', model: config.model })
    expect(mocks.fetch).toHaveBeenCalledOnce()
    const [url, request] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(request.headers.Authorization).toBe('Bearer private-oauth-access-token')
    expect(request.redirect).toBe('error')
    expect(JSON.parse(request.body)).toEqual(preview.requestBody)
    expect(preview.requestBody).toMatchObject({ store: false, stream: true, model: config.model })
    expect(preview.requestBody).not.toHaveProperty('max_output_tokens')
    expect(preview.requestBody).not.toHaveProperty('reasoning')
    expect(JSON.stringify(preview)).not.toMatch(/Alice Private|Bob Private|private-oauth-access-token/)
    expect(ordered.map((match) => match.resume.id)).toEqual([2, 1])
    expect(ordered[0].score).toBe(results[1].score)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('decodes split UTF-8, CRLF boundaries, comments and multiline event data', async () => {
    const entries = ranking.map((entry) => ({ ...entry, reason: 'قاد تطوير منصات موثوقة.' }))
    const json = JSON.stringify({ type: 'response.completed', response: openaiResponse(entries) })
    const split = json.indexOf(',') + 1
    mocks.fetch.mockResolvedValue(eventResponse(
      ': keep alive\r\n\r\nevent: response.completed\r\nid: ignored\r\n' +
      `data: ${json.slice(0, split)}\r\ndata: ${json.slice(split)}\r\n\r\n`, 1
    ))
    const ordered = await run()
    expect(ordered[0].llmReason).toBe('قاد تطوير منصات موثوقة.')
  })

  it.each([
    ['subscription_sharing_usage_limit_exceeded', 'usage limit'],
    ['subscription_sharing_usage_unavailable', 'currently unavailable'],
    ['subscription_sharing_user_not_eligible', 'not eligible'],
    ['subscription_sharing_unsupported_capability', 'not supported'],
    ['subscription_sharing_route_not_supported', 'not supported'],
    ['subscription_sharing_invalid_user', 'could not authorize'],
    ['chatpass_v2_scope_not_authorized', 'could not authorize'],
    ['chatpass_v2_invalid_authorization_context', 'could not authorize'],
    ['subscription_sharing_user_unavailable', 'Try again later']
  ])('rejects %s after valid-looking partial text and keeps local results', async (code, expected) => {
    const before = structuredClone(results)
    const cancel = vi.fn()
    mocks.fetch.mockResolvedValue(eventResponse(
      sseEvent('response.output_text.delta', { delta: JSON.stringify({ ranking }) }) +
      sseEvent('response.failed', { response: { status: 'failed', error: { code, message: 'private-oauth-access-token Alice Private' }, output: openaiResponse().output } }),
      61, cancel, false
    ))
    const failure = await run().catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain(expected)
    expect((failure as Error).message).not.toMatch(/private-oauth|Alice Private/)
    expect(results).toEqual(before)
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('handles documented errors in direct error events and HTTP errors without leaking messages', async () => {
    const error = { code: 'subscription_sharing_usage_limit_exceeded', message: 'private-oauth-access-token Alice Private' }
    for (const response of [
      eventResponse(sseEvent('error', error)),
      eventResponse(sseEvent('error', { error })),
      Response.json({ error }, { status: 429 })
    ]) {
      mocks.fetch.mockResolvedValue(response)
      const failure = await run().catch((value: Error) => value)
      expect((failure as Error).message).toContain('usage limit')
      expect((failure as Error).message).not.toMatch(/private-oauth|Alice Private/)
    }
  })

  it.each([401, 403, 404, 429, 503])('sanitizes ChatGPT HTTP %s without claiming an API key was used', async (status) => {
    mocks.fetch.mockResolvedValue(new Response('private-oauth-access-token Alice Private', { status }))
    const failure = await run().catch((error: Error) => error)
    expect((failure as Error).message).toContain('ChatGPT')
    expect((failure as Error).message).not.toMatch(/private-oauth|Alice Private|API key|API credits/)
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })

  it.each([
    sseEvent('response.output_text.delta', { delta: JSON.stringify({ ranking }) }),
    'data: [DONE]\n\n',
    sseEvent('response.incomplete', { response: openaiResponse() }),
    sseEvent('response.completed', { response: { ...openaiResponse(), status: 'incomplete' } }),
    sseEvent('response.completed', { response: openaiResponse() }).trimEnd(),
    sseEvent('response.failed', { response: { error: { code: 'unknown', message: 'private-oauth-access-token' } } })
  ])('requires a complete success event instead of partial or interrupted output %#', async (text) => {
    mocks.fetch.mockResolvedValue(eventResponse(text, 29))
    await expect(run()).rejects.toThrow('did not finish the ranking')
  })

  it('rejects refusals even when a completed event contains a valid ranking', async () => {
    const response = openaiResponse()
    mocks.fetch.mockResolvedValue(eventResponse(sseEvent('response.completed', {
      response: { ...response, output: [...response.output, { type: 'message', content: [{ type: 'refusal', refusal: 'Private refusal text' }] }] }
    })))
    await expect(run()).rejects.toThrow('declined to rerank')
  })

  it.each([
    'event: response.completed\ndata: private-oauth-access-token\n\n',
    'event: response.completed\ndata: []\n\n',
    'event: response.completed\ndata: {"type":"response.failed"}\n\n',
    sseEvent('response.completed', { response: { status: 'completed', output: [] } })
  ])('rejects malformed events and unusable completed responses safely %#', async (text) => {
    mocks.fetch.mockResolvedValue(eventResponse(text))
    await expect(run()).rejects.toThrow('did not return a usable ranking')
  })

  it('bounds cumulative stream bytes even when each event is small', async () => {
    const cancel = vi.fn()
    const text = sseEvent('response.output_text.delta', { delta: 'x'.repeat(1000) }).repeat(1100)
    mocks.fetch.mockResolvedValue(eventResponse(text, 8192, cancel, false))
    await expect(run()).rejects.toThrow('did not return a usable ranking')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects an oversized declared stream and a non-SSE response before accepting text', async () => {
    for (const response of [
      new Response('', { headers: { 'content-type': 'text/event-stream', 'content-length': String(1024 * 1024 + 1) } }),
      Response.json(openaiResponse())
    ]) {
      mocks.fetch.mockResolvedValue(response)
      await expect(run()).rejects.toThrow('did not return a usable ranking')
    }
  })

  it('cancels a stalled reader when the request times out', async () => {
    const controller = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    const cancel = vi.fn()
    mocks.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } }))
    const pending = run()
    await Promise.resolve()
    await Promise.resolve()
    controller.abort(new DOMException('private-oauth-access-token', 'TimeoutError'))
    await expect(pending).rejects.toThrow('The ChatGPT rerank request timed out')
    expect(cancel).toHaveBeenCalledOnce()
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })

  it('stops an in-flight plan stream when its account connection is cancelled', async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    mocks.fetch.mockResolvedValue(eventResponse(
      sseEvent('response.output_text.delta', { delta: JSON.stringify({ ranking }) }), 4096, cancel, false
    ))
    const before = structuredClone(results)
    const pending = rerank({ apiKey: 'private-oauth-access-token', jobDescription: 'Private job', results, config, signal: controller.signal })
    await Promise.resolve()
    await Promise.resolve()
    controller.abort(new DOMException('Private cancellation context', 'AbortError'))
    await expect(pending).rejects.toThrow('The ChatGPT rerank request was cancelled. The local ranking is unchanged.')
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(results).toEqual(before)
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('never sends a plan request that was already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(rerank({ apiKey: 'test', jobDescription: 'Private job', results, config, signal: controller.signal })).rejects.toThrow('was cancelled')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
