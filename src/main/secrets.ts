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
 * Stored values are tagged, so a cleartext key written by an earlier version
 * still reads back, and a platform where encryption is unavailable degrades to
 * the old behaviour rather than silently failing to save.
 */
import { safeStorage } from 'electron'
import { getSetting, setSetting } from './db/index.js'

const KEY = 'anthropicApiKey'
const PREFIX = 'enc.v1:'

/** Whether a key is stored. Deliberately does not decrypt; see the note above. */
export function hasApiKey(): boolean {
  return getSetting(KEY) !== null
}

/** The plaintext key. Touches the keychain, so only call it to use the key. */
export function getApiKey(): string | null {
  const raw = getSetting(KEY)
  if (!raw) return null

  if (!raw.startsWith(PREFIX)) {
    // Written before this module existed. Re-save it encrypted so the cleartext
    // copy does not linger, but hand back the key either way.
    setApiKey(raw)
    return raw
  }

  try {
    return safeStorage.decryptString(Buffer.from(raw.slice(PREFIX.length), 'base64'))
  } catch {
    // Undecryptable, most likely a library copied to another machine or a
    // denied keychain prompt. Report it as absent rather than throwing: the
    // caller's fallback is a clear "no API key" message.
    return null
  }
}

export function setApiKey(key: string | null): void {
  const trimmed = key?.trim()
  if (!trimmed) {
    setSetting(KEY, null)
    return
  }

  // A refused or unavailable keychain must not cost the user their key, so the
  // cleartext path stays as a fallback rather than surfacing an error.
  try {
    if (safeStorage.isEncryptionAvailable()) {
      setSetting(KEY, PREFIX + safeStorage.encryptString(trimmed).toString('base64'))
      return
    }
  } catch {
    /* fall through */
  }
  setSetting(KEY, trimmed)
}
