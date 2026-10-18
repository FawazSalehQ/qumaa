import { shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ChatGptStatus, ChatGptModel } from '../../shared/chatgpt.js'
import { isChatGptModelId } from '../../shared/rerank.js'
import { maintenance } from '../maintenance.js'
import {
  assertProtectedStorage, clearAccountTokens, getHostId, getPendingClientId, hasTokens, readMetadata, readTokens,
  saveAccountTokens, saveMetadata, setPendingClientId, type StoredAccount, type StoredTokens
} from './store.js'
import {
  buildAuthorizationUrl, ChatGptAuthError, createCallbackListener, DIRECT_SCOPE, exchangeCode,
  fetchJson, isTerminalRefreshError, refreshTokens, RESOURCE, revokeTokens, validateIdentity
} from './oauth.js'

let generation = 0
let pendingSignIn: AbortController | null = null
let changeHandler: () => void = () => {}
const operations = new Set<AbortController>()
const requests = new Set<AbortController>()
const rotating = new Map<string, AbortController>()
const signingOut = new Set<string>()
const refreshing = new Map<string, Promise<string>>()

export function setChatGptChangeHandler(handler: () => void): void { changeHandler = handler }

/** Inference owns this lease until its stream settles; account changes abort it immediately. */
export function beginChatGptRequest(): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  requests.add(controller)
  return { signal: controller.signal, dispose: () => { requests.delete(controller) } }
}

function cancelActiveWork(): void {
  for (const controller of requests) controller.abort()
  const rotations = new Set(rotating.values())
  for (const controller of operations) if (!rotations.has(controller)) controller.abort()
}

export function getChatGptStatus(): ChatGptStatus {
  const metadata = readMetadata()
  const active = metadata.accounts.find((account) => account.id === metadata.activeAccountId)
  return {
    accounts: metadata.accounts.map((account) => ({
      id: account.id, label: account.label,
      connected: hasTokens(account.id) && !signingOut.has(account.id),
      planUsageEnabled: account.planUsageEnabled && hasTokens(account.id) && !signingOut.has(account.id)
    })),
    activeAccountId: active?.id ?? null, signingIn: pendingSignIn !== null,
    models: active && hasTokens(active.id) && active.planUsageEnabled ? active.models.map((model) => ({ ...model })) : [],
    welcomePending: metadata.welcomePending
  }
}

/** Stable through ordinary token rotation; changes when account/permission/session changes. */
export function getChatGptCredentialRevision(): string {
  const metadata = readMetadata()
  const account = metadata.accounts.find((entry) => entry.id === metadata.activeAccountId)
  return createHash('sha256').update(JSON.stringify([
    account?.id, account?.revision, account?.planUsageEnabled,
    account ? hasTokens(account.id) && !signingOut.has(account.id) : false
  ])).digest('hex')
}

export function cancelChatGptSignIn(): void {
  const previous = pendingSignIn
  pendingSignIn = null
  previous?.abort()
}

/** Called before restore/wipe/quit, while admission to stale library work is closing. */
export function invalidateChatGptOperations(): void {
  generation++
  cancelChatGptSignIn()
  for (const operation of operations) operation.abort()
  for (const request of requests) request.abort()
  refreshing.clear()
}

function assertCurrent(expectedGeneration: number, signal?: AbortSignal): void {
  if (expectedGeneration !== generation || signal?.aborted) {
    throw new ChatGptAuthError('The ChatGPT connection changed. Try the action again.', 'cancelled')
  }
}
function currentAccount(): StoredAccount {
  const metadata = readMetadata()
  const account = metadata.accounts.find((entry) => entry.id === metadata.activeAccountId)
  if (!account || !hasTokens(account.id) || signingOut.has(account.id)) {
    throw new ChatGptAuthError('Sign in to ChatGPT before using your plan.')
  }
  if (!account.planUsageEnabled) throw new ChatGptAuthError('Enable ChatGPT plan usage by connecting this account again.')
  return account
}

export async function signInChatGpt(accountId?: string): Promise<ChatGptStatus> {
  cancelChatGptSignIn()
  const controller = new AbortController()
  pendingSignIn = controller
  const initialGeneration = generation
  try {
    const prepared = await maintenance.runOperation(() => {
      assertCurrent(initialGeneration, controller.signal)
      assertProtectedStorage()
      const metadata = readMetadata()
      if (signingOut.size) throw new ChatGptAuthError('Wait for ChatGPT sign-out to finish, then connect again.')
      const account = accountId ? metadata.accounts.find((entry) => entry.id === accountId) : undefined
      if (accountId && !account) throw new ChatGptAuthError('Choose a saved ChatGPT account or add a new one.')
      if (!account && metadata.accounts.length >= 20) throw new ChatGptAuthError('Qumaa already has the maximum number of saved ChatGPT accounts.')
      const oldTokens = account && hasTokens(account.id) ? readTokens(account.id) : undefined
      return { account, oldTokens, hostId: getHostId(), pendingClientId: account ? undefined : getPendingClientId() }
    })
    let clientId = prepared.account?.clientId ?? prepared.pendingClientId
    let verified: { tokens: StoredTokens; subject: string; email: string | null; clientId: string } | undefined
    // A consumed/expired code is never replayed. Retain the issued client ID for
    // one fresh authorization instead of registering a duplicate client.
    for (let attempt = 0; attempt < 2; attempt++) {
      assertCurrent(initialGeneration, controller.signal)
      const listener = await createCallbackListener(clientId, controller.signal)
      try {
        const authorizationUrl = buildAuthorizationUrl(listener.transaction, prepared.hostId, {
          idToken: prepared.oldTokens?.idToken, email: prepared.account?.email ?? undefined,
          consent: prepared.account ? !prepared.account.planUsageEnabled : false
        })
        try { await shell.openExternal(authorizationUrl) }
        catch { throw new ChatGptAuthError('Qumaa could not open your browser. Start ChatGPT sign-in again.') }
        const callback = await listener.result
        assertCurrent(initialGeneration, controller.signal)
        clientId = callback.clientId
        if (!prepared.account) {
          await maintenance.runOperation(() => {
            assertCurrent(initialGeneration, controller.signal)
            setPendingClientId(callback.clientId)
          })
        }
        let tokens: StoredTokens
        try { tokens = await exchangeCode(listener.transaction, callback.code, clientId, controller.signal) }
        catch (error) {
          if (attempt === 0 && error instanceof ChatGptAuthError && error.code === 'invalid_grant') continue
          throw error
        }
        const identity = await validateIdentity(tokens.idToken, clientId, listener.transaction.nonce, controller.signal)
        if (prepared.account && (prepared.account.clientId !== clientId || prepared.account.subject !== identity.subject)) {
          throw new ChatGptAuthError('The selected ChatGPT account did not match. Its saved connection was kept.')
        }
        verified = { tokens, ...identity, clientId }
        break
      } finally { listener.cancel() }
    }
    if (!verified) throw new ChatGptAuthError('ChatGPT sign-in expired. Start sign-in again.')
    const result = verified
    await maintenance.runOperation(() => {
      assertCurrent(initialGeneration, controller.signal)
      if (pendingSignIn !== controller) throw new ChatGptAuthError('ChatGPT sign-in was cancelled.')
      const metadata = readMetadata()
      let account = prepared.account ? metadata.accounts.find((entry) => entry.id === prepared.account!.id)
        : metadata.accounts.find((entry) => entry.clientId === result.clientId && entry.subject === result.subject)
      if (prepared.account && (!account || account.revision !== prepared.account.revision)) {
        throw new ChatGptAuthError('The saved ChatGPT connection changed. Start sign-in again.')
      }
      if (!account) {
        const id = randomUUID()
        account = {
          id, clientId: result.clientId, subject: result.subject, email: result.email,
          label: `${result.email ?? 'ChatGPT'} · ${id.slice(0, 8)}`,
          planUsageEnabled: false, revision: randomUUID(), models: [], scopes: []
        }
        metadata.accounts.push(account)
      }
      account.email = result.email
      account.planUsageEnabled = result.tokens.scopes.includes(DIRECT_SCOPE)
      account.scopes = result.tokens.scopes
      account.revision = randomUUID()
      account.models = []
      metadata.activeAccountId = account.id
      metadata.welcomePending = account.planUsageEnabled && !metadata.welcomeSeen
      saveAccountTokens(metadata, account.id, result.tokens)
      if (getPendingClientId() === result.clientId) setPendingClientId(null)
      cancelActiveWork()
      changeHandler()
    })
    // Connection is already committed if the model service is temporarily down.
    // The user can explicitly retry the model refresh from Settings.
    if (result.tokens.scopes.includes(DIRECT_SCOPE)) {
      try { await refreshChatGptModels() } catch { /* Preserve the validated account. */ }
    }
    if (pendingSignIn === controller) pendingSignIn = null
    return await maintenance.runOperation(getChatGptStatus)
  } finally {
    if (pendingSignIn === controller) pendingSignIn = null
    controller.abort()
  }
}

export async function selectChatGptAccount(accountId: string): Promise<void> {
  const shouldRefresh = await maintenance.runOperation(() => {
    const metadata = readMetadata()
    const account = metadata.accounts.find((entry) => entry.id === accountId)
    if (!account) throw new ChatGptAuthError('Choose a saved ChatGPT account.')
    if (metadata.activeAccountId !== accountId) {
      cancelChatGptSignIn()
      cancelActiveWork()
      metadata.activeAccountId = accountId
      saveMetadata(metadata)
      changeHandler()
    }
    return account.planUsageEnabled && hasTokens(account.id)
  })
  if (shouldRefresh) {
    try { await refreshChatGptModels() } catch { /* Saved selection remains available offline. */ }
  }
}

/** Caller already owns the shared maintenance lease; never acquire a nested lease here. */
export async function getChatGptAccessToken(): Promise<string> {
  const account = currentAccount()
  const existingRefresh = refreshing.get(account.id)
  if (existingRefresh) return existingRefresh
  const tokens = readTokens(account.id)
  if (!tokens.identityPending && tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken
  const initialGeneration = generation
  const controller = new AbortController()
  operations.add(controller)
  rotating.set(account.id, controller)
  let task!: Promise<string>
  task = (async (): Promise<string> => {
    try {
      let replacement: StoredTokens
      if (tokens.identityPending && tokens.expiresAt > Date.now() + 60_000) replacement = tokens
      else {
        replacement = await refreshTokens(account.clientId, tokens, controller.signal)
        assertCurrent(initialGeneration, controller.signal)
        const metadata = readMetadata()
        const live = metadata.accounts.find((entry) => entry.id === account.id)
        if (!live || live.revision !== account.revision || signingOut.has(account.id)) throw new ChatGptAuthError('The ChatGPT connection changed. Try again.')
        // Persist rotation before fetching verification keys. If that fetch fails,
        // retry verification of this protected replacement, never the spent refresh token.
        replacement.identityPending = tokens.identityPending || replacement.idToken !== tokens.idToken
        saveAccountTokens(metadata, account.id, replacement)
      }
      if (replacement.identityPending) {
        const identity = await validateIdentity(replacement.idToken, account.clientId, undefined, controller.signal)
        if (identity.subject !== account.subject) throw new ChatGptAuthError('ChatGPT returned a different account. Reconnect before using your plan.')
      }
      assertCurrent(initialGeneration, controller.signal)
      const metadata = readMetadata()
      const live = metadata.accounts.find((entry) => entry.id === account.id)
      if (!live || live.revision !== account.revision || signingOut.has(account.id)) throw new ChatGptAuthError('The ChatGPT connection changed. Try again.')
      const enabled = replacement.scopes.includes(DIRECT_SCOPE)
      const permissionsChanged = enabled !== live.planUsageEnabled ||
        [...live.scopes].sort().join(' ') !== [...replacement.scopes].sort().join(' ')
      live.planUsageEnabled = enabled
      live.scopes = replacement.scopes
      replacement.identityPending = false
      if (permissionsChanged) live.revision = randomUUID()
      saveAccountTokens(metadata, account.id, replacement)
      if (permissionsChanged) changeHandler()
      if (!enabled) throw new ChatGptAuthError('ChatGPT plan permission is disabled. Connect the account again to enable it.')
      return replacement.accessToken
    } catch (error) {
      if (isTerminalRefreshError(error) && initialGeneration === generation && !controller.signal.aborted) {
        const metadata = readMetadata()
        const live = metadata.accounts.find((entry) => entry.id === account.id)
        if (live?.revision === account.revision) {
          live.revision = randomUUID()
          live.planUsageEnabled = false
          live.models = []
          clearAccountTokens(metadata, account.id)
          changeHandler()
        }
      }
      throw error
    } finally {
      operations.delete(controller)
      if (rotating.get(account.id) === controller) rotating.delete(account.id)
      if (refreshing.get(account.id) === task) refreshing.delete(account.id)
    }
  })()
  refreshing.set(account.id, task)
  return task
}

const modelCatalogSchema = z.object({ models: z.array(z.object({
  slug: z.string().min(1).max(200), display_name: z.string().min(1).max(200), visibility: z.string()
})).max(1000) })
export async function refreshChatGptModels(): Promise<ChatGptStatus> {
  return maintenance.runOperation(async () => {
    const account = currentAccount()
    const initialGeneration = generation
    const controller = new AbortController()
    operations.add(controller)
    try {
      const token = await getChatGptAccessToken()
      assertCurrent(initialGeneration, controller.signal)
      const raw = await fetchJson(`${RESOURCE}/models`, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      const parsed = modelCatalogSchema.safeParse(raw)
      if (!parsed.success) throw new ChatGptAuthError('ChatGPT returned an unreadable model list. Refresh models and try again.')
      const models: ChatGptModel[] = []
      const seen = new Set<string>()
      for (const model of parsed.data.models) {
        if (model.visibility === 'list' && isChatGptModelId(model.slug) && !seen.has(model.slug)) {
          seen.add(model.slug)
          models.push({ id: model.slug, label: model.display_name })
        }
      }
      assertCurrent(initialGeneration, controller.signal)
      const metadata = readMetadata()
      const live = metadata.accounts.find((entry) => entry.id === account.id)
      if (!live || live.revision !== account.revision || metadata.activeAccountId !== account.id) {
        throw new ChatGptAuthError('The selected ChatGPT account changed. Refresh its models again.')
      }
      live.models = models
      saveMetadata(metadata)
      return getChatGptStatus()
    } finally { operations.delete(controller) }
  })
}

export async function signOutChatGpt(accountId: string): Promise<{ remoteRevocationConfirmed: boolean }> {
  // Block sends immediately, including ones waiting on a keychain/network call.
  signingOut.add(accountId)
  cancelChatGptSignIn()
  cancelActiveWork()
  rotating.get(accountId)?.abort()
  try {
    return await maintenance.runOperation(async () => {
      changeHandler()
      const metadata = readMetadata()
      const account = metadata.accounts.find((entry) => entry.id === accountId)
      if (!account) throw new ChatGptAuthError('Choose a saved ChatGPT account.')
      let tokens: StoredTokens | undefined
      try { if (hasTokens(accountId)) tokens = readTokens(accountId) } catch { /* Local sign-out must still work. */ }
      const controller = new AbortController()
      operations.add(controller)
      let remoteRevocationConfirmed = false
      try { if (tokens) remoteRevocationConfirmed = await revokeTokens(account.clientId, tokens, controller.signal) }
      finally { operations.delete(controller) }
      // Still within the shared lease: an exclusive library replacement cannot
      // have committed, even if its request cancelled remote revocation.
      const latest = readMetadata()
      const live = latest.accounts.find((entry) => entry.id === accountId)
      if (live) {
        live.planUsageEnabled = false
        live.models = []
        live.revision = randomUUID()
        if (latest.activeAccountId === accountId) latest.welcomePending = false
        clearAccountTokens(latest, accountId)
        changeHandler()
      }
      return { remoteRevocationConfirmed }
    })
  } finally { signingOut.delete(accountId) }
}

export async function acknowledgeChatGptWelcome(): Promise<void> {
  await maintenance.runOperation(() => {
    const metadata = readMetadata()
    metadata.welcomePending = false
    metadata.welcomeSeen = true
    saveMetadata(metadata)
  })
}
