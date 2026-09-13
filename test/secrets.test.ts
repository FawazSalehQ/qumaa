/**
 * The API key is the one secret this app stores, so the storage format matters:
 * a key written by an older version must migrate safely, while a machine where
 * protected storage is unavailable must never fall back to plaintext.
 *
 * `electron` and the database are mocked so this runs without booting an app.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string | null>()
const safeStorage = {
  available: true,
  throwOnAvailable: false,
  throwOnEncrypt: false,
  isEncryptionAvailable: vi.fn(() => {
    if (safeStorage.throwOnAvailable) throw new Error('keychain unavailable')
    return safeStorage.available
  }),
  // Reversible stand-in for real OS encryption: the test only cares that the
  // stored bytes are not the plaintext and that they round trip.
  encryptString: vi.fn((s: string) => {
    if (safeStorage.throwOnEncrypt) throw new Error('encryption failed')
    return Buffer.from(`CIPHER(${s})`)
  }),
  decryptString: vi.fn((b: Buffer) => {
    const m = /^CIPHER\((.*)\)$/s.exec(b.toString())
    if (!m) throw new Error('not decryptable')
    return m[1]
  })
}

const database = {
  exec: vi.fn(),
  pragma: vi.fn(() => [{ busy: 0, log: 0, checkpointed: 0 }]),
  prepare: vi.fn((sql: string) => ({
    run: (key: string, value?: string | null) => {
      if (sql.startsWith('DELETE')) store.delete(key)
      else if (value === null || value === undefined) store.delete(key)
      else store.set(key, value)
      return { changes: 1 }
    }
  })),
  transaction: <T>(fn: () => T) => () => fn()
}

vi.mock('electron', () => ({ safeStorage }))
vi.mock('../src/main/db/index.js', () => ({
  checkpointWalOrThrow: () => {
    const result = database.pragma('wal_checkpoint(TRUNCATE)')[0]
    if (!result || result.busy !== 0 || result.log !== result.checkpointed) {
      throw new Error('checkpoint failed')
    }
  },
  getDb: () => database,
  getSetting: (k: string) => store.get(k) ?? null,
  setSetting: (k: string, v: string | null) => {
    if (v === null) store.delete(k)
    else store.set(k, v)
  }
}))

const {
  finishPendingSecretCleanup,
  getApiKey,
  getApiKeyRevision,
  getApiKeyStatus,
  hasApiKey,
  protectLegacyApiKey,
  setApiKey
} = await import('../src/main/secrets.js')

const KEY = 'anthropicApiKey'
const SECRET = 'sk-ant-api03-not-a-real-key'

beforeEach(() => {
  store.clear()
  safeStorage.available = true
  safeStorage.throwOnAvailable = false
  safeStorage.throwOnEncrypt = false
  vi.clearAllMocks()
})

describe('API key storage', () => {
  it('keeps provider credentials independent and defaults legacy calls to Anthropic', () => {
    setApiKey(SECRET)
    setApiKey('sk-test-openai-only', 'openai')
    expect(getApiKey('anthropic')).toBe(SECRET)
    expect(getApiKey('openai')).toBe('sk-test-openai-only')
    expect(store.get('openaiApiKey')).not.toContain('sk-test-openai-only')

    setApiKey(null, 'openai')
    expect(getApiKey('openai')).toBeNull()
    expect(getApiKey()).toBe(SECRET)
    setApiKey('sk-test-openai-only', 'openai')
    setApiKey(null)
    expect(getApiKey()).toBeNull()
    expect(getApiKey('openai')).toBe('sk-test-openai-only')
  })

  it('reads statuses and credential revisions for both providers without keychain access', () => {
    setApiKey(SECRET)
    setApiKey('sk-test-openai-only', 'openai')
    const anthropicRevision = getApiKeyRevision('anthropic')
    const openaiRevision = getApiKeyRevision('openai')
    vi.clearAllMocks()

    for (const provider of ['anthropic', 'openai'] as const) {
      expect(hasApiKey(provider)).toBe(true)
      expect(getApiKeyStatus(provider)).toBe('protected')
      expect(getApiKeyRevision(provider)).toMatch(/^[a-f0-9]{64}$/)
    }
    expect(safeStorage.decryptString).not.toHaveBeenCalled()
    expect(safeStorage.encryptString).not.toHaveBeenCalled()
    expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled()

    setApiKey('sk-test-openai-replacement', 'openai')
    expect(getApiKeyRevision('anthropic')).toBe(anthropicRevision)
    expect(getApiKeyRevision('openai')).not.toBe(openaiRevision)
    const replacementRevision = getApiKeyRevision('openai')
    setApiKey(null, 'openai')
    expect(getApiKeyRevision('openai')).not.toBe(replacementRevision)
  })

  it('protects only the requested legacy provider', () => {
    store.set(KEY, SECRET)
    store.set('openaiApiKey', 'sk-test-openai-legacy')
    expect(protectLegacyApiKey('openai')).toBe(true)
    expect(getApiKey('openai')).toBe('sk-test-openai-legacy')
    expect(getApiKeyStatus('anthropic')).toBe('migration-needed')
    expect(store.get(KEY)).toBe(SECRET)
  })

  it('fails closed for an OpenAI key without modifying either provider', () => {
    setApiKey(SECRET)
    const anthropicValue = store.get(KEY)
    safeStorage.available = false
    expect(() => setApiKey('sk-test-openai-only', 'openai')).toThrow('Protected credential storage is unavailable')
    expect(store.get(KEY)).toBe(anthropicValue)
    expect(store.has('openaiApiKey')).toBe(false)
  })

  it('round trips a key through encryption', () => {
    setApiKey(SECRET)
    expect(getApiKey()).toBe(SECRET)
  })

  it('does not write the key in cleartext', () => {
    setApiKey(SECRET)
    const stored = store.get(KEY)!
    expect(stored).not.toContain(SECRET)
    expect(stored.startsWith('enc.v1:')).toBe(true)
  })

  it('answers hasApiKey without touching the keychain', () => {
    // This is what the settings handler calls on launch. Decrypting there would
    // mean an OS permission dialog on the startup path.
    setApiKey(SECRET)
    vi.clearAllMocks()

    expect(hasApiKey()).toBe(true)
    expect(getApiKeyStatus()).toBe('protected')
    expect(safeStorage.decryptString).not.toHaveBeenCalled()
    expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled()
  })

  it('reports a cleartext key as migration-needed without using it', () => {
    store.set(KEY, SECRET)
    expect(getApiKeyStatus()).toBe('migration-needed')
    expect(hasApiKey()).toBe(false)
    expect(() => getApiKey()).toThrow('Protect the API key')
  })

  it('protects a cleartext key only through the deliberate migration action', () => {
    store.set(KEY, SECRET)
    expect(protectLegacyApiKey()).toBe(true)
    expect(store.get(KEY)!.startsWith('enc.v1:')).toBe(true)
    expect(store.get('credentialCleanupPending')).toBe('true')
    expect(getApiKey()).toBe(SECRET)
  })

  it('refuses a new key without modifying storage when encryption is unavailable', () => {
    safeStorage.available = false
    store.set(KEY, 'enc.v1:existing')

    expect(() => setApiKey(SECRET)).toThrow('Protected credential storage is unavailable')
    expect(store.get(KEY)).toBe('enc.v1:existing')
  })

  it('refuses a new key without writing plaintext when the keychain throws', () => {
    safeStorage.throwOnAvailable = true

    expect(() => setApiKey(SECRET)).toThrow('Protected credential storage is unavailable')
    expect(store.has(KEY)).toBe(false)
  })

  it('preserves an existing value if OS encryption itself fails', () => {
    store.set(KEY, 'enc.v1:existing')
    safeStorage.throwOnEncrypt = true

    expect(() => setApiKey(SECRET)).toThrow('Protected credential storage is unavailable')
    expect(store.get(KEY)).toBe('enc.v1:existing')
  })

  it('does not rewrite a legacy plaintext key when encryption is unavailable', () => {
    store.set(KEY, SECRET)
    safeStorage.available = false

    expect(() => protectLegacyApiKey()).toThrow('Protected credential storage is unavailable')
    expect(store.get(KEY)).toBe(SECRET)
    expect(safeStorage.encryptString).not.toHaveBeenCalled()
  })

  it('surfaces an actionable error for an undecryptable protected value', () => {
    store.set(KEY, 'enc.v1:' + Buffer.from('garbage').toString('base64'))
    expect(() => getApiKey()).toThrow('Remove it and add it again')
  })

  it('vacuum-checkpoints legacy plaintext remnants before clearing the retry marker', () => {
    store.set(KEY, SECRET)
    protectLegacyApiKey()

    expect(finishPendingSecretCleanup()).toBe(true)
    expect(database.exec).toHaveBeenCalledWith('VACUUM')
    expect(database.pragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)')
    expect(store.has('credentialCleanupPending')).toBe(false)
  })

  it('clears the key', () => {
    setApiKey(SECRET)
    setApiKey(null)
    expect(getApiKey()).toBeNull()
    expect(hasApiKey()).toBe(false)
  })

  it('treats a blank key as clearing it', () => {
    setApiKey(SECRET)
    setApiKey('   ')
    expect(hasApiKey()).toBe(false)
  })

  it('trims surrounding whitespace from a pasted key', () => {
    setApiKey(`  ${SECRET}\n`)
    expect(getApiKey()).toBe(SECRET)
  })
})
