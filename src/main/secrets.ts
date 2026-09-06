/**
 * Storage for the only secret this app holds: the optional Anthropic API key.
 *
 * The settings table is a plain SQLite file, so a key written there sits in
 * cleartext on disk for anything that can read the user's home directory.
 * `safeStorage` hands the encryption to the OS instead (Keychain on macOS,
 * DPAPI on Windows), which is where a credential belongs.
 *
 * The one hard rule here: **nothing on the startup path may touch the
 * keychain.** On macOS the first `safeStorage` call blocks the calling process
 * on an OS permission dialog, so doing it while restoring settings would freeze
 * the app before the window is usable. Hence `hasApiKey`, which the settings
 * handler calls on launch, only asks whether a value is stored and never
 * decrypts. Encryption happens when the user saves a key, decryption when a
 * rerank actually runs, and both are deliberate user actions.
 *
 * Stored values are tagged. A cleartext key written by an earlier version is
 * reported as migration-needed and cannot be used until the user deliberately
 * protects or removes it. New plaintext keys are never written to the database.
 */
import { safeStorage } from 'electron'
import { checkpointWalOrThrow, getDb, getSetting, setSetting } from './db/index.js'

const KEY = 'anthropicApiKey'
const PREFIX = 'enc.v1:'
const CLEANUP_KEY = 'credentialCleanupPending'

export type ApiKeyStatus = 'none' | 'protected' | 'migration-needed'

export class SecureStorageUnavailableError extends Error {
  constructor() {
    super('Protected credential storage is unavailable. The API key was not saved.')
    this.name = 'SecureStorageUnavailableError'
  }
}

export class ApiKeyMigrationRequiredError extends Error {
  constructor() {
    super('Protect the API key saved by the older Qumaa version before using Claude reranking.')
    this.name = 'ApiKeyMigrationRequiredError'
  }
}

export class ApiKeyUnlockError extends Error {
  constructor() {
    super('Protected credential storage could not unlock the API key. Remove it and add it again.')
    this.name = 'ApiKeyUnlockError'
  }
}

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encrypt(key: string): string {
  try {
    if (!encryptionAvailable()) throw new SecureStorageUnavailableError()
    return PREFIX + safeStorage.encryptString(key).toString('base64')
  } catch (error) {
    if (error instanceof SecureStorageUnavailableError) throw error
    throw new SecureStorageUnavailableError()
  }
}

/** Safe startup-time status: inspects only the tag and never touches the keychain. */
export function getApiKeyStatus(): ApiKeyStatus {
  const raw = getSetting(KEY)
  if (!raw) return 'none'
  return raw.startsWith(PREFIX) ? 'protected' : 'migration-needed'
}

/** Whether a usable protected key is stored. Never reports legacy plaintext as safe. */
export function hasApiKey(): boolean {
  return getApiKeyStatus() === 'protected'
}

/** The plaintext key. Touches the keychain, so only call it to use the key. */
export function getApiKey(): string | null {
  const raw = getSetting(KEY)
  if (!raw) return null

  if (!raw.startsWith(PREFIX)) throw new ApiKeyMigrationRequiredError()

  try {
    return safeStorage.decryptString(Buffer.from(raw.slice(PREFIX.length), 'base64'))
  } catch {
    throw new ApiKeyUnlockError()
  }
}

function replaceLegacyValue(value: string | null): void {
  const database = getDb()
  const write = database.prepare(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const remove = database.prepare('DELETE FROM settings WHERE key = ?')
  database.transaction(() => {
    if (value === null) remove.run(KEY)
    else write.run(KEY, value)
    write.run(CLEANUP_KEY, 'true')
  })()
}

/**
 * Saves or removes a key. Returns true when old plaintext pages require the
 * exclusive cleanup pass below.
 */
export function setApiKey(key: string | null): boolean {
  const trimmed = key?.trim()
  const replacingLegacy = getApiKeyStatus() === 'migration-needed'
  if (!trimmed) {
    if (replacingLegacy) replaceLegacyValue(null)
    else getDb().prepare('DELETE FROM settings WHERE key = ?').run(KEY)
    return replacingLegacy
  }

  // Fail closed. The caller gets an actionable error and the database remains
  // untouched rather than quietly becoming a plaintext credential store.
  const protectedValue = encrypt(trimmed)
  if (replacingLegacy) replaceLegacyValue(protectedValue)
  else setSetting(KEY, protectedValue)
  return replacingLegacy
}

/** Deliberate user action that protects the legacy value without exposing it. */
export function protectLegacyApiKey(): boolean {
  const raw = getSetting(KEY)
  if (!raw || raw.startsWith(PREFIX)) return false
  const protectedValue = encrypt(raw)
  replaceLegacyValue(protectedValue)
  return true
}

export function hasPendingSecretCleanup(): boolean {
  return getSetting(CLEANUP_KEY) === 'true'
}

/**
 * Purges pages/WAL frames that may contain a legacy plaintext value. Call only
 * under exclusive maintenance; no keychain access is involved, so an
 * interrupted cleanup can safely retry on the next launch.
 */
export function finishPendingSecretCleanup(): boolean {
  if (!hasPendingSecretCleanup()) return false
  const database = getDb()
  database.exec('VACUUM')
  checkpointWalOrThrow('Qumaa could not finish removing the legacy plaintext credential.')
  database.prepare('DELETE FROM settings WHERE key = ?').run(CLEANUP_KEY)
  checkpointWalOrThrow('Qumaa could not finish credential cleanup.')
  return true
}
