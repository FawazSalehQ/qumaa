/**
 * The API key is the one secret this app stores, so the storage format matters:
 * a key written by an older version must keep working, and a machine where the
 * OS keychain is unavailable or refuses must not lose the user's key.
 *
 * `electron` and the database are mocked so this runs without booting an app.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string | null>()
const safeStorage = {
  available: true,
  throwOnAvailable: false,
  isEncryptionAvailable: vi.fn(() => {
    if (safeStorage.throwOnAvailable) throw new Error('keychain unavailable')
    return safeStorage.available
  }),
  // Reversible stand-in for real OS encryption: the test only cares that the
  // stored bytes are not the plaintext and that they round trip.
  encryptString: vi.fn((s: string) => Buffer.from(`CIPHER(${s})`)),
  decryptString: vi.fn((b: Buffer) => {
    const m = /^CIPHER\((.*)\)$/s.exec(b.toString())
    if (!m) throw new Error('not decryptable')
    return m[1]
  })
}

vi.mock('electron', () => ({ safeStorage }))
vi.mock('../src/main/db/index.js', () => ({
  getSetting: (k: string) => store.get(k) ?? null,
  setSetting: (k: string, v: string | null) => {
    if (v === null) store.delete(k)
    else store.set(k, v)
  }
}))

const { getApiKey, hasApiKey, setApiKey } = await import('../src/main/secrets.js')

const KEY = 'anthropicApiKey'
const SECRET = 'sk-ant-api03-not-a-real-key'

beforeEach(() => {
  store.clear()
  safeStorage.available = true
  safeStorage.throwOnAvailable = false
  vi.clearAllMocks()
})

describe('API key storage', () => {
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
    expect(safeStorage.decryptString).not.toHaveBeenCalled()
    expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled()
  })

  it('reads back a cleartext key written by an earlier version', () => {
    store.set(KEY, SECRET)
    expect(getApiKey()).toBe(SECRET)
  })

  it('re-encrypts a cleartext key in place on first read', () => {
    store.set(KEY, SECRET)
    getApiKey()
    expect(store.get(KEY)!.startsWith('enc.v1:')).toBe(true)
    expect(getApiKey()).toBe(SECRET)
  })

  it('keeps the key when the keychain is unavailable', () => {
    safeStorage.available = false
    setApiKey(SECRET)
    expect(getApiKey()).toBe(SECRET)
  })

  it('keeps the key when the keychain throws', () => {
    safeStorage.throwOnAvailable = true
    setApiKey(SECRET)
    expect(getApiKey()).toBe(SECRET)
  })

  it('reports an undecryptable value as absent instead of throwing', () => {
    store.set(KEY, 'enc.v1:' + Buffer.from('garbage').toString('base64'))
    expect(() => getApiKey()).not.toThrow()
    expect(getApiKey()).toBeNull()
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
