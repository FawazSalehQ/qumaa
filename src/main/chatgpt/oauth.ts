/** Public-client OAuth contract from developers.openai.com/siwc/token-sharing-open-source. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'
import { z } from 'zod'
import type { StoredTokens } from './store.js'

export const ISSUER = 'https://auth.openai.com'
export const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`
export const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`
export const RESOURCE = 'https://api.openai.com/v1'
export const DIRECT_SCOPE = 'chatgpt.tokens.use.direct'
export const SCOPES = `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`
const CALLBACK_PATH = '/auth/callback'
const MAX_RESPONSE_BYTES = 1024 * 1024
const TERMINAL_REFRESH_CODES = new Set([
  'invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired',
  'refresh_token_invalidated', 'refresh_token_reused'
])

/** Only controlled text and bounded codes cross IPC; server messages can contain secrets. */
export class ChatGptAuthError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message)
    this.name = 'ChatGptAuthError'
  }
}
export function isTerminalRefreshError(error: unknown): boolean {
  return error instanceof ChatGptAuthError && !!error.code && TERMINAL_REFRESH_CODES.has(error.code)
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { reject(new Error('Connection cancelled or timed out.')) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const timeout = AbortSignal.timeout(15_000)
  const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout
  let response: Response
  try { response = await abortable(fetch(url, { ...init, redirect: 'error', signal }), signal) }
  catch { throw new ChatGptAuthError('Could not reach ChatGPT. Check your connection and try again.') }
  let parsed: unknown
  try {
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new Error()
    const reader = response.body?.getReader()
    const parts: Uint8Array[] = []
    let length = 0
    try {
      while (reader) {
        const chunk = await abortable(reader.read(), signal)
        if (chunk.done) break
        length += chunk.value.length
        if (length > MAX_RESPONSE_BYTES) throw new Error()
        parts.push(chunk.value)
      }
    } finally { void reader?.cancel().catch(() => {}) }
    const text = Buffer.concat(parts).toString('utf8')
    parsed = text ? JSON.parse(text) : null
  } catch { throw new ChatGptAuthError('ChatGPT returned an unreadable response. Try again.', undefined, response.status) }
  if (!response.ok) {
    const error = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).error : null
    const code = typeof error === 'string' ? error : error && typeof error === 'object'
      ? (error as Record<string, unknown>).code : null
    const safeCode = typeof code === 'string' && /^[a-z0-9_]{1,100}$/.test(code) ? code : undefined
    throw new ChatGptAuthError(
      safeCode && TERMINAL_REFRESH_CODES.has(safeCode)
        ? 'The ChatGPT connection expired or was revoked. Sign in again.'
        : 'ChatGPT could not complete this connection request. Try again or reconnect.', safeCode, response.status
    )
  }
  return parsed
}

function authEndpoint(value: unknown): string {
  if (typeof value !== 'string') throw new ChatGptAuthError('ChatGPT sign-in configuration is unavailable.')
  let url: URL
  try { url = new URL(value) } catch { throw new ChatGptAuthError('ChatGPT sign-in configuration is unavailable.') }
  if (url.origin !== ISSUER || url.username || url.password || url.hash) {
    throw new ChatGptAuthError('ChatGPT sign-in configuration is unavailable.')
  }
  return url.href
}
export async function getDiscovery(signal?: AbortSignal): Promise<{ jwksUri: string; revocationEndpoint: string }> {
  const raw = await fetchJson(`${ISSUER}/.well-known/openid-configuration`, { signal })
  const data = z.object({
    issuer: z.literal(ISSUER), jwks_uri: z.string(), revocation_endpoint: z.string(),
    authorization_endpoint: z.literal(AUTHORIZE_URL), token_endpoint: z.literal(TOKEN_URL)
  }).safeParse(raw)
  if (!data.success) throw new ChatGptAuthError('ChatGPT sign-in configuration is unavailable.')
  return { jwksUri: authEndpoint(data.data.jwks_uri), revocationEndpoint: authEndpoint(data.data.revocation_endpoint) }
}

export interface OAuthTransaction {
  state: string; nonce: string; verifier: string; redirectUri: string; clientId?: string
}
export function buildAuthorizationUrl(
  transaction: OAuthTransaction, hostId: string, hints: { idToken?: string; email?: string; consent?: boolean } = {}
): string {
  const params = new URLSearchParams({
    client_id: transaction.clientId ?? 'dynamic_agent_client', ext_agent_host_id: hostId,
    response_type: 'code', redirect_uri: transaction.redirectUri, scope: SCOPES, resource: RESOURCE,
    state: transaction.state, nonce: transaction.nonce, code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(transaction.verifier).digest('base64url')
  })
  if (!transaction.clientId) params.set('agent_name_hint', 'Qumaa')
  else {
    if (hints.idToken) params.set('id_token_hint', hints.idToken)
    if (hints.email) params.set('login_hint', hints.email)
    if (hints.consent) params.set('prompt', 'consent')
  }
  return `${AUTHORIZE_URL}?${params}`
}

export function parseCallback(rawUrl: string, host: string | undefined, method: string | undefined,
  transaction: OAuthTransaction): { code: string; clientId: string } | null {
  if (method !== 'GET' || rawUrl.length > 16384) return null
  const expected = new URL(transaction.redirectUri)
  if (host !== expected.host || !rawUrl.startsWith('/')) return null
  let url: URL
  try { url = new URL(rawUrl, expected.origin) } catch { return null }
  if (url.origin !== expected.origin || url.pathname !== CALLBACK_PATH || url.hash) return null
  for (const key of ['state', 'code', 'client_id', 'error']) {
    if (url.searchParams.getAll(key).length > 1) return null
  }
  const state = url.searchParams.get('state') ?? ''
  if (Buffer.byteLength(state) !== Buffer.byteLength(transaction.state) ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(transaction.state))) return null
  if (url.searchParams.has('error')) throw new ChatGptAuthError('ChatGPT sign-in was declined or cancelled.', 'access_denied')
  const code = url.searchParams.get('code')
  const suppliedId = url.searchParams.get('client_id')
  const clientId = suppliedId ?? transaction.clientId
  if (!code || code.length > 8192 || !clientId || !/^[A-Za-z0-9_-]{1,512}$/.test(clientId) ||
    clientId === 'dynamic_agent_client' || (transaction.clientId && suppliedId && suppliedId !== transaction.clientId)) {
    throw new ChatGptAuthError('ChatGPT sign-in was incomplete. Start sign-in again.')
  }
  return { code, clientId }
}

export interface CallbackListener {
  transaction: OAuthTransaction
  result: Promise<{ code: string; clientId: string }>
  cancel(): void
}
export async function createCallbackListener(clientId?: string, signal?: AbortSignal): Promise<CallbackListener> {
  const transaction: OAuthTransaction = {
    state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'),
    verifier: randomBytes(64).toString('base64url'), redirectUri: '', clientId
  }
  let server: Server
  let timer: ReturnType<typeof setTimeout> | undefined
  let complete = false
  let resolve!: (result: { code: string; clientId: string }) => void
  let reject!: (error: Error) => void
  const result = new Promise<{ code: string; clientId: string }>((yes, no) => { resolve = yes; reject = no })
  // Browser opening may reject before the caller awaits this promise.
  void result.catch(() => {})
  const cleanup = (): void => {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    server.close()
    server.closeAllConnections()
  }
  const cancel = (): void => {
    if (complete) return
    complete = true
    cleanup()
    reject(new ChatGptAuthError('ChatGPT sign-in was cancelled.', 'cancelled'))
  }
  server = createServer({ maxHeaderSize: 20_000, requestTimeout: 5000, headersTimeout: 5000 }, (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (complete) { res.writeHead(410).end('This sign-in attempt has ended.'); return }
    try {
      const value = parseCallback(req.url ?? '', req.headers.host, req.method, transaction)
      if (!value) { res.writeHead(400).end('Invalid sign-in callback.'); return }
      complete = true
      res.end('ChatGPT sign-in received. Return to Qumaa to finish connecting.')
      resolve(value)
      // Let this small browser response flush before closing its socket.
      res.on('finish', cleanup)
    } catch {
      complete = true
      res.writeHead(400).end('ChatGPT sign-in could not be completed. Return to Qumaa and try again.')
      reject(new ChatGptAuthError('ChatGPT sign-in was declined or incomplete. Try again.'))
      res.on('finish', cleanup)
    }
  })
  server.maxConnections = 8
  try {
    await new Promise<void>((yes, no) => {
      server.once('error', no)
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', no); yes() })
    })
  } catch { server.close(); throw new ChatGptAuthError('Qumaa could not open the local ChatGPT sign-in callback.') }
  const address = server.address()
  if (!address || typeof address === 'string') { cancel(); throw new ChatGptAuthError('ChatGPT callback unavailable.') }
  transaction.redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
  server.on('error', cancel)
  timer = setTimeout(cancel, 5 * 60_000)
  timer.unref()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  return { transaction, result, cancel }
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(65536), refresh_token: z.string().min(1).max(65536).optional(),
  id_token: z.string().min(1).max(65536).optional(), token_type: z.string(),
  expires_in: z.number().int().min(1).max(86400), scope: z.string().max(20_000)
})
export function parseTokenResponse(raw: unknown, previous?: StoredTokens): StoredTokens {
  const result = tokenResponseSchema.safeParse(raw)
  if (!result.success || result.data.token_type.toLowerCase() !== 'bearer') {
    throw new ChatGptAuthError('ChatGPT returned an incomplete credential response. Reconnect and try again.')
  }
  const data = result.data
  const idToken = data.id_token ?? previous?.idToken
  const scopes = [...new Set(data.scope.split(/\s+/).filter(Boolean))]
  if (!idToken || ((previous?.refreshToken || scopes.includes('offline_access')) && !data.refresh_token)) {
    throw new ChatGptAuthError('ChatGPT returned an incomplete credential response. Reconnect and try again.')
  }
  return {
    accessToken: data.access_token, refreshToken: data.refresh_token,
    idToken, expiresAt: Date.now() + data.expires_in * 1000,
    scopes
  }
}

export async function exchangeCode(transaction: OAuthTransaction, code: string, clientId: string,
  signal?: AbortSignal): Promise<StoredTokens> {
  return parseTokenResponse(await fetchJson(TOKEN_URL, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code,
      code_verifier: transaction.verifier, redirect_uri: transaction.redirectUri, resource: RESOURCE })
  }))
}

export async function refreshTokens(clientId: string, tokens: StoredTokens, signal?: AbortSignal): Promise<StoredTokens> {
  if (!tokens.refreshToken) throw new ChatGptAuthError('Sign in to ChatGPT again before using your plan.', 'invalid_refresh_token')
  return parseTokenResponse(await fetchJson(TOKEN_URL, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId,
      refresh_token: tokens.refreshToken, resource: RESOURCE })
  }), tokens)
}

export async function validateIdentity(idToken: string, clientId: string, nonce?: string,
  signal?: AbortSignal): Promise<{ subject: string; email: string | null }> {
  const { jwksUri } = await getDiscovery(signal)
  const keys = await fetchJson(jwksUri, { signal })
  try {
    const { payload } = await jwtVerify(idToken, createLocalJWKSet(keys as JSONWebKeySet), {
      issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
      algorithms: ['RS256', 'ES256']
    })
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 512 ||
      (nonce !== undefined && payload.nonce !== nonce) ||
      (payload.azp !== undefined && payload.azp !== clientId) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) ||
      typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now() / 1000) + 5 ||
      typeof payload.exp !== 'number' || payload.exp <= payload.iat) throw new Error()
    return { subject: payload.sub,
      email: typeof payload.email === 'string' && payload.email.length <= 320 ? payload.email : null }
  } catch { throw new ChatGptAuthError('ChatGPT identity verification failed. Start sign-in again.') }
}

export async function revokeTokens(clientId: string, tokens: StoredTokens, signal?: AbortSignal): Promise<boolean> {
  if (!tokens.refreshToken) return false
  try {
    const { revocationEndpoint } = await getDiscovery(signal)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await fetchJson(revocationEndpoint, { method: 'POST', signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokens.refreshToken, token_type_hint: 'refresh_token', client_id: clientId }) })
        return true
      } catch (error) {
        if (signal?.aborted || attempt > 0 || (error instanceof ChatGptAuthError && error.status && error.status < 500)) return false
        await new Promise<void>((resolve) => setTimeout(resolve, 300))
      }
    }
  } catch { /* Local sign-out remains available when revocation is unavailable. */ }
  return false
}
