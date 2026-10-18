import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import {
  AUTHORIZE_URL, buildAuthorizationUrl, ChatGptAuthError, createCallbackListener,
  exchangeCode, fetchJson, getDiscovery, ISSUER, isTerminalRefreshError, parseCallback,
  parseTokenResponse, refreshTokens, RESOURCE, revokeTokens, SCOPES, TOKEN_URL, validateIdentity,
  type OAuthTransaction
} from '../src/main/chatgpt/oauth.js'

const httpState = vi.hoisted(() => ({
  handler: null as null | ((request: object, response: object) => void),
  server: null as null | (EventEmitter & { close: ReturnType<typeof vi.fn>; closeAllConnections: ReturnType<typeof vi.fn>; listen: ReturnType<typeof vi.fn> })
}))
vi.mock('node:http', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  return { createServer: (_options: unknown, handler: (request: object, response: object) => void) => {
    const server = Object.assign(new Emitter(), {
      close: vi.fn(), closeAllConnections: vi.fn(), address: () => ({ port: 54321 }),
      listen: vi.fn((_port: number, _host: string, done: () => void) => queueMicrotask(done))
    })
    httpState.handler = handler
    httpState.server = server
    return server
  } }
})
function callbackRequest(url: string): { status: number; headers: Map<string, string> } {
  const state = { status: 200, headers: new Map<string, string>() }
  const res = Object.assign(new EventEmitter(), {
    setHeader: (key: string, value: string) => state.headers.set(key.toLowerCase(), value),
    writeHead: (status: number) => { state.status = status; return res },
    end: () => { queueMicrotask(() => res.emit('finish')); return res }
  })
  httpState.handler!({ url, headers: { host: '127.0.0.1:54321' }, method: 'GET' }, res)
  return state
}

const transaction: OAuthTransaction = {
  state: 'random-state', nonce: 'random-nonce', verifier: 'a'.repeat(64),
  redirectUri: 'http://127.0.0.1:54321/auth/callback'
}
const discovery = {
  issuer: ISSUER, authorization_endpoint: AUTHORIZE_URL, token_endpoint: TOKEN_URL,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`, revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`
}
const response = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('ChatGPT public-client OAuth contract', () => {
  it('builds first registration with fresh PKCE material and no client secret', () => {
    const url = new URL(buildAuthorizationUrl(transaction, 'urn:uuid:host'))
    expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE_URL)
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'dynamic_agent_client', agent_name_hint: 'Qumaa', ext_agent_host_id: 'urn:uuid:host',
      response_type: 'code', redirect_uri: transaction.redirectUri, scope: SCOPES, resource: RESOURCE,
      state: transaction.state, nonce: transaction.nonce, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(transaction.verifier).digest('base64url')
    })
    expect(url.searchParams.has('client_secret')).toBe(false)
    expect(url.searchParams.has('prompt')).toBe(false)
  })

  it('reuses the issued client and only sends retained identity hints to authorization', () => {
    const url = new URL(buildAuthorizationUrl({ ...transaction, clientId: 'oaiapp_saved' }, 'urn:uuid:host', {
      idToken: 'retained-id', email: 'person@example.com', consent: true
    }))
    expect(url.searchParams.get('client_id')).toBe('oaiapp_saved')
    expect(url.searchParams.has('agent_name_hint')).toBe(false)
    expect(url.searchParams.get('id_token_hint')).toBe('retained-id')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.has('force_reconsent')).toBe(false)
  })

  it('requires an issued client for registration and binds returning callback clients', () => {
    const path = '/auth/callback?state=random-state&code=once&client_id=oaiapp_new'
    expect(parseCallback(path, '127.0.0.1:54321', 'GET', transaction)).toEqual({ code: 'once', clientId: 'oaiapp_new' })
    expect(() => parseCallback(path.replace('&client_id=oaiapp_new', ''), '127.0.0.1:54321', 'GET', transaction)).toThrow('incomplete')
    expect(() => parseCallback(path.replace('oaiapp_new', 'dynamic_agent_client'), '127.0.0.1:54321', 'GET', transaction)).toThrow('incomplete')
    expect(() => parseCallback(path, '127.0.0.1:54321', 'GET', { ...transaction, clientId: 'oaiapp_saved' })).toThrow('incomplete')
    expect(parseCallback(path.replace('&client_id=oaiapp_new', ''), '127.0.0.1:54321', 'GET', {
      ...transaction, clientId: 'oaiapp_saved'
    })).toEqual({ code: 'once', clientId: 'oaiapp_saved' })
  })

  it.each([
    ['/auth/callback?state=other&code=once&client_id=oaiapp_new', '127.0.0.1:54321', 'GET'],
    ['/auth/callback?state=random-state&state=random-state&code=once&client_id=oaiapp_new', '127.0.0.1:54321', 'GET'],
    ['/auth/callback?state=random-state&code=once&code=twice&client_id=oaiapp_new', '127.0.0.1:54321', 'GET'],
    ['/auth/callback?state=random-state&code=once&client_id=oaiapp_new', 'attacker.test:54321', 'GET'],
    ['/auth/callback?state=random-state&code=once&client_id=oaiapp_new', 'localhost:54321', 'GET'],
    ['/callback?state=random-state&code=once&client_id=oaiapp_new', '127.0.0.1:54321', 'GET'],
    ['/auth/callback?state=random-state&code=once&client_id=oaiapp_new', '127.0.0.1:54321', 'POST'],
    ['//attacker.test/auth/callback?state=random-state&code=once&client_id=oaiapp_new', '127.0.0.1:54321', 'GET'],
    ['//[', '127.0.0.1:54321', 'GET']
  ])('ignores invalid callback boundary %s', (url, host, method) => {
    expect(parseCallback(url, host, method, transaction)).toBeNull()
  })

  it('checks state before accepting denied consent', () => {
    expect(parseCallback('/auth/callback?state=wrong&error=access_denied', '127.0.0.1:54321', 'GET', transaction)).toBeNull()
    expect(() => parseCallback('/auth/callback?state=random-state&error=access_denied', '127.0.0.1:54321', 'GET', transaction)).toThrow('declined')
  })

  it('uses a loopback listener, ignores bad states, and accepts its one-use callback', async () => {
    const listener = await createCallbackListener()
    try {
      const callback = new URL(listener.transaction.redirectUri)
      expect(callback.hostname).toBe('127.0.0.1')
      expect(callback.pathname).toBe('/auth/callback')
      expect(listener.transaction.state).not.toBe(transaction.state)
      callback.search = new URLSearchParams({ state: 'wrong', code: 'unused', client_id: 'oaiapp_once' }).toString()
      expect(httpState.server!.listen).toHaveBeenCalledWith(0, '127.0.0.1', expect.any(Function))
      expect(callbackRequest(callback.pathname + callback.search).status).toBe(400)
      callback.searchParams.set('state', listener.transaction.state)
      const accepted = callbackRequest(callback.pathname + callback.search)
      expect(accepted.status).toBe(200)
      expect(accepted.headers.get('cache-control')).toBe('no-store')
      expect(await listener.result).toEqual({ code: 'unused', clientId: 'oaiapp_once' })
      expect(callbackRequest(callback.pathname + callback.search).status).toBe(410)
      expect(httpState.server!.close).toHaveBeenCalled()
    } finally { listener.cancel() }
  })

  it('cancels listeners without leaving a pending result', async () => {
    const controller = new AbortController()
    const listener = await createCallbackListener(undefined, controller.signal)
    controller.abort()
    await expect(listener.result).rejects.toThrow('cancelled')
    expect(httpState.server!.close).toHaveBeenCalled()
  })

  it('exchanges the issued client with the exact URI and refreshes without re-requesting scopes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ access_token: 'access', refresh_token: 'refresh',
      id_token: 'identity', token_type: 'Bearer', expires_in: 3600, scope: SCOPES }))
    vi.stubGlobal('fetch', fetchMock)
    const tokens = await exchangeCode(transaction, 'code', 'oaiapp_new')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(fetchMock.mock.calls[0][0]).toBe(TOKEN_URL)
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      grant_type: 'authorization_code', client_id: 'oaiapp_new', code: 'code', code_verifier: transaction.verifier,
      redirect_uri: transaction.redirectUri, resource: RESOURCE
    })
    expect(init.redirect).toBe('error')
    fetchMock.mockResolvedValueOnce(response({ access_token: 'next-access', refresh_token: 'next-refresh',
      token_type: 'Bearer', expires_in: 3600, scope: SCOPES }))
    const next = await refreshTokens('oaiapp_new', tokens)
    expect(next.refreshToken).toBe('next-refresh')
    expect(next.idToken).toBe('identity')
    expect(Object.fromEntries(fetchMock.mock.calls[1][1].body as URLSearchParams)).toEqual({
      grant_type: 'refresh_token', client_id: 'oaiapp_new', refresh_token: 'refresh', resource: RESOURCE
    })
  })

  it('rejects malformed token responses and missing rotating refresh tokens', () => {
    const raw = { access_token: 'access', refresh_token: 'refresh', id_token: 'id', token_type: 'Bearer', expires_in: 3600, scope: SCOPES }
    const old = parseTokenResponse(raw)
    expect(() => parseTokenResponse({ ...raw, expires_in: -1 })).toThrow('incomplete')
    expect(() => parseTokenResponse({ ...raw, token_type: 'Basic' })).toThrow('incomplete')
    expect(() => parseTokenResponse({ ...raw, refresh_token: undefined }, old)).toThrow('incomplete')
    expect(() => parseTokenResponse({ ...raw, refresh_token: undefined })).toThrow('incomplete')
    expect(() => parseTokenResponse({ ...raw, id_token: undefined })).toThrow('incomplete')
  })

  it('rejects discovery endpoint substitution before sending credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...discovery, revocation_endpoint: 'https://attacker.test/revoke' })))
    await expect(getDiscovery()).rejects.toThrow('configuration')
  })

  it('bounds response bodies and never includes server diagnostics in thrown text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('x'.repeat(1024 * 1024 + 1)))
      .mockResolvedValueOnce(response({ error: 'invalid_grant', error_description: 'SECRET-TOKEN' }, 400)))
    await expect(fetchJson(TOKEN_URL)).rejects.toThrow('unreadable')
    const error = await fetchJson(TOKEN_URL).catch((caught) => caught)
    expect(error).toBeInstanceOf(ChatGptAuthError)
    expect(error.code).toBe('invalid_grant')
    expect(String(error)).not.toContain('SECRET-TOKEN')
    expect(isTerminalRefreshError(error)).toBe(true)
    expect(isTerminalRefreshError(new ChatGptAuthError('temporary', undefined, 503))).toBe(false)
  })

  it('cancels a stalled response body without waiting for it to send another byte', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream())))
    const pending = fetchJson(TOKEN_URL, { signal: controller.signal })
    await new Promise<void>((resolve) => setImmediate(resolve))
    controller.abort()
    await expect(pending).rejects.toThrow('unreadable')
  })

  it('revokes the refresh token at the discovered trusted endpoint and accepts empty 200', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(discovery)).mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await revokeTokens('oaiapp_saved', {
      accessToken: 'access', refreshToken: 'refresh', idToken: 'id', expiresAt: Date.now() + 3600_000, scopes: SCOPES.split(' ')
    })).toBe(true)
    expect(fetchMock.mock.calls[1][0]).toBe(discovery.revocation_endpoint)
    expect(Object.fromEntries(fetchMock.mock.calls[1][1].body as URLSearchParams)).toEqual({
      token: 'refresh', token_type_hint: 'refresh_token', client_id: 'oaiapp_saved'
    })
  })
})

describe('ChatGPT signed identity verification', () => {
  let pair: Awaited<ReturnType<typeof generateKeyPair>>
  let jwks: object
  beforeAll(async () => {
    pair = await generateKeyPair('RS256')
    jwks = { keys: [{ ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }] }
  })
  async function sign(overrides: Record<string, unknown> = {}): Promise<string> {
    return new SignJWT({ sub: 'account-subject', iss: ISSUER, aud: 'oaiapp_new',
      exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
      nonce: transaction.nonce, email: 'person@example.com', ...overrides
    }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(pair.privateKey)
  }
  function mockKeys(): void {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => response(
      url.endsWith('openid-configuration') ? discovery : jwks
    )))
  }
  it('accepts a verified issuer, audience, nonce and identity', async () => {
    mockKeys()
    expect(await validateIdentity(await sign(), 'oaiapp_new', transaction.nonce)).toEqual({
      subject: 'account-subject', email: 'person@example.com'
    })
  })
  it.each([
    { iss: 'https://attacker.test' }, { aud: 'oaiapp_other' }, { nonce: 'replayed-nonce' },
    { exp: 100 }, { sub: '' }, { iat: undefined }, { iat: Math.floor(Date.now() / 1000) + 60 },
    { aud: ['oaiapp_new', 'oaiapp_other'] }, { azp: 'oaiapp_other' }
  ])('rejects invalid signed claims %j', async (overrides) => {
    mockKeys()
    await expect(validateIdentity(await sign(overrides), 'oaiapp_new', transaction.nonce)).rejects.toThrow('verification failed')
  })
  it('rejects a forged signature even with valid claims', async () => {
    mockKeys()
    const original = (await sign()).split('.')
    original[2] = Buffer.alloc(256).toString('base64url')
    await expect(validateIdentity(original.join('.'), 'oaiapp_new', transaction.nonce)).rejects.toThrow('verification failed')
  })
})
