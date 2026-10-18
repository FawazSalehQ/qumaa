/** Main-only ChatGPT credentials. Reading public status never unlocks the keychain. */
import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getDb, getSetting, setSetting } from '../db/index.js'

const META_KEY = 'chatgpt:accounts:v1'
const HOST_KEY = 'chatgpt:host:v1'
const PENDING_CLIENT_KEY = 'chatgpt:pending-client:v1'
const PREFIX = 'enc.v1:'
const credentialKey = (id: string): string => `chatgpt:credentials:${id}`
const modelSchema = z.object({ id: z.string().min(1).max(200), label: z.string().min(1).max(200) })
const accountSchema = z.object({
  id: z.string().uuid(), clientId: z.string().min(1).max(512), subject: z.string().min(1).max(512),
  email: z.string().max(320).nullable(), label: z.string().min(1).max(400),
  planUsageEnabled: z.boolean(), revision: z.string().uuid(), models: z.array(modelSchema).max(1000),
  scopes: z.array(z.string().min(1).max(200)).max(100).default([])
})
const metadataSchema = z.object({
  accounts: z.array(accountSchema).max(20), activeAccountId: z.string().uuid().nullable(),
  welcomePending: z.boolean(), welcomeSeen: z.boolean().default(false)
})
const tokensSchema = z.object({
  accessToken: z.string().min(1).max(65536), refreshToken: z.string().min(1).max(65536).optional(),
  idToken: z.string().min(1).max(65536), expiresAt: z.number().finite().min(0).max(8.64e15),
  scopes: z.array(z.string().min(1).max(200)).max(100), identityPending: z.boolean().optional()
})
export type StoredAccount = z.infer<typeof accountSchema>
export type AccountMetadata = z.infer<typeof metadataSchema>
export type StoredTokens = z.infer<typeof tokensSchema>

export function readMetadata(): AccountMetadata {
  const raw = getSetting(META_KEY)
  if (raw) {
    try { return metadataSchema.parse(JSON.parse(raw)) } catch { /* Ignore untrusted/corrupt settings. */ }
  }
  return { accounts: [], activeAccountId: null, welcomePending: false, welcomeSeen: false }
}

/** An issued registration may survive a failed code exchange without becoming an account. */
export function getPendingClientId(): string | undefined {
  const id = getSetting(PENDING_CLIENT_KEY)
  return id && id !== 'dynamic_agent_client' && /^[A-Za-z0-9_-]{1,512}$/.test(id) ? id : undefined
}
export function setPendingClientId(id: string | null): void { setSetting(PENDING_CLIENT_KEY, id) }

export function saveMetadata(metadata: AccountMetadata): void {
  setSetting(META_KEY, JSON.stringify(metadataSchema.parse(metadata)))
}

export function getHostId(): string {
  const old = getSetting(HOST_KEY)
  if (old && /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(old)) return old
  const id = `urn:uuid:${randomUUID()}`
  setSetting(HOST_KEY, id)
  return id
}

export function hasTokens(id: string): boolean {
  return getSetting(credentialKey(id))?.startsWith(PREFIX) ?? false
}

export function assertProtectedStorage(): void {
  try {
    if (!safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error()
  } catch {
    throw new Error('Protected credential storage is unavailable. ChatGPT was not connected.')
  }
}

export function readTokens(id: string): StoredTokens {
  const raw = getSetting(credentialKey(id))
  if (!raw?.startsWith(PREFIX)) throw new Error('Sign in to ChatGPT again before using your plan.')
  try {
    return tokensSchema.parse(JSON.parse(safeStorage.decryptString(Buffer.from(raw.slice(PREFIX.length), 'base64'))))
  } catch {
    throw new Error('Qumaa could not unlock the ChatGPT connection. Sign out and connect again.')
  }
}

/** Encrypt before the transaction; a failed keychain operation cannot replace working credentials. */
export function saveAccountTokens(metadata: AccountMetadata, accountId: string, tokens: StoredTokens): void {
  assertProtectedStorage()
  let protectedValue: string
  try { protectedValue = PREFIX + safeStorage.encryptString(JSON.stringify(tokensSchema.parse(tokens))).toString('base64') }
  catch { throw new Error('Protected credential storage could not save the ChatGPT connection.') }
  getDb().transaction(() => {
    setSetting(credentialKey(accountId), protectedValue)
    saveMetadata(metadata)
  })()
}

export function clearAccountTokens(metadata: AccountMetadata, accountId: string): void {
  getDb().transaction(() => {
    setSetting(credentialKey(accountId), null)
    saveMetadata(metadata)
  })()
}
