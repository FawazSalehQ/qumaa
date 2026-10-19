import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { deferred } from './fixtures/async.js'

const fixture = vi.hoisted(() => ({
  store: new Map<string, string | null>(), encryptionAvailable: true,
  encrypt: vi.fn((value: string) => Buffer.from(`CIPHER(${value})`)),
  decrypt: vi.fn((value: Buffer) => {
    const raw = /^CIPHER\((.*)\)$/s.exec(value.toString())
    if (!raw) throw new Error('unreadable')
    return raw[1]
  }),
  openBrowser: vi.fn(async () => {}), callback: vi.fn(), exchange: vi.fn(), identity: vi.fn(),
  refresh: vi.fn(), revoke: vi.fn(), json: vi.fn()
}))
vi.mock('electron', () => ({
  shell: { openExternal: fixture.openBrowser },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => fixture.encryptionAvailable),
    getSelectedStorageBackend: () => 'keychain', encryptString: fixture.encrypt, decryptString: fixture.decrypt
  }
}))
vi.mock('../src/main/db/index.js', () => ({
  getDb: () => ({ transaction: <T>(fn: () => T) => fn }),
  getSetting: (key: string) => fixture.store.get(key) ?? null,
  setSetting: (key: string, value: string | null) => fixture.store.set(key, value)
}))
vi.mock('../src/main/chatgpt/oauth.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/chatgpt/oauth.js')>(),
  createCallbackListener: fixture.callback, exchangeCode: fixture.exchange,
  validateIdentity: fixture.identity, refreshTokens: fixture.refresh,
  revokeTokens: fixture.revoke, fetchJson: fixture.json
}))
const chatgpt = await import('../src/main/chatgpt/index.js')
const store = await import('../src/main/chatgpt/store.js')
const { ChatGptAuthError, DIRECT_SCOPE, SCOPES } = await import('../src/main/chatgpt/oauth.js')
const changed = vi.fn()
function tokens(overrides: Partial<import('../src/main/chatgpt/store.js').StoredTokens> = {}) {
  return { accessToken: 'test-access-secret', refreshToken: 'test-refresh-secret', idToken: 'test-id-secret',
    expiresAt: Date.now() + 3600_000, scopes: SCOPES.split(' '), ...overrides }
}
async function settleUntil(check: () => boolean): Promise<void> {
  for (let i = 0; i < 40 && !check(); i++) await new Promise<void>((resolve) => setImmediate(resolve))
  expect(check()).toBe(true)
}
function activeId(): string { return chatgpt.getChatGptStatus().activeAccountId! }
function expireActive(): void {
  store.saveAccountTokens(store.readMetadata(), activeId(), tokens({ expiresAt: Date.now() - 1000 }))
}

beforeEach(() => {
  chatgpt.invalidateChatGptOperations()
  fixture.store.clear()
  fixture.encryptionAvailable = true
  vi.clearAllMocks()
  fixture.callback.mockImplementation(async (clientId?: string) => ({
    transaction: { state: 'state', nonce: 'nonce', verifier: 'verifier', redirectUri: 'http://127.0.0.1:12345/auth/callback', clientId },
    result: Promise.resolve({ code: 'one-use-code', clientId: clientId ?? `oaiapp_${randomUUID().replaceAll('-', '')}` }),
    cancel: vi.fn()
  }))
  fixture.exchange.mockImplementation(async () => tokens())
  fixture.identity.mockResolvedValue({ subject: 'validated-subject', email: 'person@example.com' })
  fixture.refresh.mockImplementation(async () => tokens({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh' }))
  fixture.revoke.mockResolvedValue(true)
  fixture.json.mockResolvedValue({ models: [
    { slug: 'gpt-test', display_name: 'Test model', visibility: 'list' },
    { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
    { slug: 'gpt-test', display_name: 'Duplicate', visibility: 'list' },
    { slug: 'bad model!', display_name: 'Invalid', visibility: 'list' }
  ] })
  chatgpt.setChatGptChangeHandler(changed)
})

describe('ChatGPT protected sessions and account lifecycle', () => {
  it('connects with encrypted tokens, public-only status, filtered models and first-use welcome', async () => {
    const status = await chatgpt.signInChatGpt()
    expect(status.signingIn).toBe(false)
    expect(status.accounts).toHaveLength(1)
    expect(status.accounts[0]).toMatchObject({ connected: true, planUsageEnabled: true })
    expect(status.models).toEqual([{ id: 'gpt-test', label: 'Test model' }])
    expect(status.welcomePending).toBe(true)
    expect(JSON.stringify(status)).not.toMatch(/secret|clientId|subject|accessToken/)
    expect(fixture.store.get('chatgpt:accounts:v1')).not.toContain('secret')
    const encrypted = fixture.store.get(`chatgpt:credentials:${activeId()}`)!
    expect(encrypted).toMatch(/^enc.v1:/)
    expect(encrypted).not.toContain('test-access-secret')
    expect(store.getPendingClientId()).toBeUndefined()
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('reads startup status and revisions without decrypting or networking', async () => {
    await chatgpt.signInChatGpt()
    vi.clearAllMocks()
    const before = chatgpt.getChatGptCredentialRevision()
    expect(chatgpt.getChatGptStatus().accounts[0].connected).toBe(true)
    chatgpt.invalidateChatGptOperations()
    expect(chatgpt.getChatGptCredentialRevision()).toBe(before)
    expect(fixture.decrypt).not.toHaveBeenCalled()
    expect(fixture.encrypt).not.toHaveBeenCalled()
    expect(fixture.json).not.toHaveBeenCalled()
  })

  it('fails closed before OAuth if the keychain is unavailable', async () => {
    fixture.encryptionAvailable = false
    await expect(chatgpt.signInChatGpt()).rejects.toThrow('Protected credential storage')
    expect(fixture.openBrowser).not.toHaveBeenCalled()
    expect(fixture.store.size).toBe(0)
  })

  it('retains identity without direct-plan permission and never fetches models or inference tokens', async () => {
    fixture.exchange.mockResolvedValue(tokens({ scopes: ['openid', 'profile', 'email'] }))
    const status = await chatgpt.signInChatGpt()
    expect(status.accounts[0]).toMatchObject({ connected: true, planUsageEnabled: false })
    expect(status.welcomePending).toBe(false)
    expect(fixture.json).not.toHaveBeenCalled()
    await expect(chatgpt.getChatGptAccessToken()).rejects.toThrow('Enable ChatGPT plan usage')
    await chatgpt.signInChatGpt(activeId())
    expect(new URL(fixture.openBrowser.mock.calls[1][0]).searchParams.get('prompt')).toBe('consent')
  })

  it('shows the welcome once after enabling plan use, not after reauthorization', async () => {
    await chatgpt.signInChatGpt()
    await chatgpt.acknowledgeChatGptWelcome()
    expect(chatgpt.getChatGptStatus().welcomePending).toBe(false)
    await chatgpt.signInChatGpt(activeId())
    expect(chatgpt.getChatGptStatus().welcomePending).toBe(false)
  })

  it('keeps same-email registrations distinct and refreshes catalog when switching', async () => {
    await chatgpt.signInChatGpt()
    const first = activeId()
    const host = store.getHostId()
    await chatgpt.signInChatGpt()
    const second = activeId()
    expect(second).not.toBe(first)
    expect(chatgpt.getChatGptStatus().accounts).toHaveLength(2)
    expect(new Set(chatgpt.getChatGptStatus().accounts.map((entry) => entry.label)).size).toBe(2)
    expect(store.getHostId()).toBe(host)
    const calls = fixture.json.mock.calls.length
    await chatgpt.selectChatGptAccount(first)
    expect(activeId()).toBe(first)
    expect(fixture.json.mock.calls.length).toBe(calls + 1)
  })

  it('keeps the selected account intact if a returning identity does not match', async () => {
    await chatgpt.signInChatGpt()
    const oldRevision = chatgpt.getChatGptCredentialRevision()
    const ciphertext = fixture.store.get(`chatgpt:credentials:${activeId()}`)
    fixture.identity.mockResolvedValue({ subject: 'another-person', email: 'person@example.com' })
    await expect(chatgpt.signInChatGpt(activeId())).rejects.toThrow('did not match')
    expect(chatgpt.getChatGptCredentialRevision()).toBe(oldRevision)
    expect(fixture.store.get(`chatgpt:credentials:${activeId()}`)).toBe(ciphertext)
  })

  it('retains an issued registration across exchange failure and retries it without new registration', async () => {
    fixture.exchange.mockRejectedValueOnce(new Error('network unavailable'))
    await expect(chatgpt.signInChatGpt()).rejects.toThrow('network unavailable')
    const issued = store.getPendingClientId()
    expect(issued).toMatch(/^oaiapp_/)
    expect(chatgpt.getChatGptStatus().accounts).toHaveLength(0)
    chatgpt.invalidateChatGptOperations()
    await chatgpt.signInChatGpt()
    const request = new URL(fixture.openBrowser.mock.calls[1][0])
    expect(request.searchParams.get('client_id')).toBe(issued)
    expect(request.searchParams.has('agent_name_hint')).toBe(false)
  })

  it('never reuses invalid_grant codes and retains the issued client for one fresh authorization', async () => {
    fixture.exchange.mockRejectedValueOnce(new ChatGptAuthError('expired', 'invalid_grant', 400))
    await chatgpt.signInChatGpt()
    expect(fixture.openBrowser).toHaveBeenCalledTimes(2)
    expect(fixture.callback.mock.calls[1][0]).toMatch(/^oaiapp_/)
    expect(fixture.exchange).toHaveBeenCalledTimes(2)
  })

  it('does not hold a maintenance lease while the browser is waiting and cannot repopulate after wipe', async () => {
    const callback = deferred<{ code: string; clientId: string }>()
    fixture.callback.mockResolvedValueOnce({ transaction: { state: 'state', nonce: 'nonce', verifier: 'verifier',
      redirectUri: 'http://127.0.0.1:12345/auth/callback' }, result: callback.promise, cancel: vi.fn() })
    const attempt = chatgpt.signInChatGpt()
    await settleUntil(() => fixture.openBrowser.mock.calls.length === 1)
    const { maintenance } = await import('../src/main/maintenance.js')
    await maintenance.runLibraryChange(() => {
      chatgpt.invalidateChatGptOperations()
      fixture.store.clear()
    })
    callback.resolve({ code: 'late-code', clientId: 'oaiapp_late' })
    await expect(attempt).rejects.toThrow('connection changed')
    expect(fixture.store.size).toBe(0)
  })

  it('serializes refresh rotation and keeps the approval revision stable', async () => {
    await chatgpt.signInChatGpt()
    expireActive()
    const revision = chatgpt.getChatGptCredentialRevision()
    const rotation = deferred<ReturnType<typeof tokens>>()
    fixture.refresh.mockReturnValueOnce(rotation.promise)
    const one = chatgpt.getChatGptAccessToken()
    const two = chatgpt.getChatGptAccessToken()
    rotation.resolve(tokens({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh' }))
    expect(await Promise.all([one, two])).toEqual(['rotated-access', 'rotated-access'])
    expect(fixture.refresh).toHaveBeenCalledTimes(1)
    expect(store.readTokens(activeId()).refreshToken).toBe('rotated-refresh')
    expect(chatgpt.getChatGptCredentialRevision()).toBe(revision)
  })

  it('retains rotated tokens pending identity verification when key retrieval temporarily fails', async () => {
    await chatgpt.signInChatGpt()
    expireActive()
    fixture.refresh.mockResolvedValueOnce(tokens({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh', idToken: 'new-identity' }))
    fixture.identity.mockRejectedValueOnce(new Error('verification service unavailable'))
    await expect(chatgpt.getChatGptAccessToken()).rejects.toThrow('verification service unavailable')
    expect(store.readTokens(activeId())).toMatchObject({ refreshToken: 'rotated-refresh', identityPending: true })
    expect(await chatgpt.getChatGptAccessToken()).toBe('rotated-access')
    expect(fixture.refresh).toHaveBeenCalledTimes(1)
    expect(store.readTokens(activeId()).identityPending).toBe(false)
  })

  it('lets old-account rotation finish during a switch while aborting in-flight inference', async () => {
    await chatgpt.signInChatGpt()
    const first = activeId()
    await chatgpt.signInChatGpt()
    const second = activeId()
    expireActive()
    const request = chatgpt.beginChatGptRequest()
    const rotation = deferred<ReturnType<typeof tokens>>()
    fixture.refresh.mockReturnValueOnce(rotation.promise)
    const pending = chatgpt.getChatGptAccessToken()
    await chatgpt.selectChatGptAccount(first)
    expect(request.signal.aborted).toBe(true)
    rotation.resolve(tokens({ refreshToken: 'second-new-refresh' }))
    await pending
    expect(store.readTokens(second).refreshToken).toBe('second-new-refresh')
    expect(activeId()).toBe(first)
    request.dispose()
  })

  it('renews an expired pending token instead of returning it after identity verification recovers', async () => {
    await chatgpt.signInChatGpt()
    store.saveAccountTokens(store.readMetadata(), activeId(), tokens({ identityPending: true,
      expiresAt: Date.now() - 1000, accessToken: 'expired-access', refreshToken: 'previously-rotated-refresh' }))
    expect(await chatgpt.getChatGptAccessToken()).toBe('rotated-access')
    expect(fixture.refresh).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ refreshToken: 'previously-rotated-refresh' }), expect.any(AbortSignal))
    expect(fixture.identity).toHaveBeenCalledTimes(2)
  })

  it('preserves credentials on temporary refresh failures, clears terminal ones, and invalidates consent', async () => {
    await chatgpt.signInChatGpt()
    expireActive()
    const revision = chatgpt.getChatGptCredentialRevision()
    fixture.refresh.mockRejectedValueOnce(new ChatGptAuthError('temporary', undefined, 503))
    await expect(chatgpt.getChatGptAccessToken()).rejects.toThrow('temporary')
    expect(chatgpt.getChatGptStatus().accounts[0].connected).toBe(true)
    fixture.refresh.mockRejectedValueOnce(new ChatGptAuthError('revoked', 'refresh_token_reused', 400))
    await expect(chatgpt.getChatGptAccessToken()).rejects.toThrow('revoked')
    expect(chatgpt.getChatGptStatus().accounts[0].connected).toBe(false)
    expect(chatgpt.getChatGptCredentialRevision()).not.toBe(revision)
  })

  it('invalidates approvals when refresh loses direct-plan permission and never returns its token', async () => {
    await chatgpt.signInChatGpt()
    expireActive()
    const revision = chatgpt.getChatGptCredentialRevision()
    fixture.refresh.mockResolvedValueOnce(tokens({ scopes: SCOPES.split(' ').filter((scope) => scope !== DIRECT_SCOPE) }))
    await expect(chatgpt.getChatGptAccessToken()).rejects.toThrow('permission is disabled')
    expect(chatgpt.getChatGptStatus().accounts[0]).toMatchObject({ connected: true, planUsageEnabled: false })
    expect(chatgpt.getChatGptCredentialRevision()).not.toBe(revision)
  })

  it('never commits a delayed refresh after library invalidation', async () => {
    await chatgpt.signInChatGpt()
    expireActive()
    const rotation = deferred<ReturnType<typeof tokens>>()
    fixture.refresh.mockReturnValueOnce(rotation.promise)
    const pending = chatgpt.getChatGptAccessToken()
    chatgpt.invalidateChatGptOperations()
    fixture.store.clear()
    rotation.resolve(tokens())
    await expect(pending).rejects.toThrow('connection changed')
    expect(fixture.store.size).toBe(0)
  })

  it('signs out locally even when revocation is not confirmed, retaining registration and host', async () => {
    await chatgpt.signInChatGpt()
    const id = activeId()
    const host = store.getHostId()
    const issued = store.readMetadata().accounts[0].clientId
    const request = chatgpt.beginChatGptRequest()
    fixture.revoke.mockResolvedValueOnce(false)
    expect(await chatgpt.signOutChatGpt(id)).toEqual({ remoteRevocationConfirmed: false })
    expect(request.signal.aborted).toBe(true)
    expect(chatgpt.getChatGptStatus().accounts[0]).toMatchObject({ id, connected: false, planUsageEnabled: false })
    expect(store.getHostId()).toBe(host)
    expect(store.readMetadata().accounts[0].clientId).toBe(issued)
    expect(store.hasTokens(id)).toBe(false)
    expect(fixture.revoke).toHaveBeenCalledWith(issued, expect.objectContaining({ refreshToken: 'test-refresh-secret' }), expect.any(AbortSignal))
    request.dispose()
  })

  it('allows local sign-out of an unreadable encrypted credential', async () => {
    await chatgpt.signInChatGpt()
    fixture.store.set(`chatgpt:credentials:${activeId()}`, 'enc.v1:unreadable')
    expect(await chatgpt.signOutChatGpt(activeId())).toEqual({ remoteRevocationConfirmed: false })
    expect(chatgpt.getChatGptStatus().accounts[0].connected).toBe(false)
  })
})
