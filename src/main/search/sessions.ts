import { createHash, randomUUID } from 'node:crypto'
import type { JsonObject } from './rerankPrivacy.js'
import type { SearchResponse } from '@shared/types.js'

type LocalSearchResponse = Omit<SearchResponse, 'sessionId'>

export interface JobSessionContext {
  jobId: string
  snapshotFingerprint: string
  versionsFingerprint: string
}

export interface SearchSession {
  id: string
  jobDescription: string
  response: LocalSearchResponse
  createdAt: number
  job?: JobSessionContext
}

interface Approval {
  sessionId: string
  requestDigest: string
  expiresAt: number
}

const SESSION_TTL_MS = 30 * 60 * 1000
const APPROVAL_TTL_MS = 10 * 60 * 1000
const MAX_SESSIONS = 12
export const MAX_PENDING_APPROVALS = 8

function requestDigest(requestBody: JsonObject, authContext = ''): string {
  return createHash('sha256').update(JSON.stringify([requestBody, authContext])).digest('hex')
}

/**
 * Main-process ownership for every Claude-bound result. The renderer receives a
 * session id, never authority to replace the posting or candidate evidence.
 */
export class SearchSessionStore {
  private readonly sessions = new Map<string, SearchSession>()
  private readonly approvals = new Map<string, Approval>()
  private readonly approvalBySession = new Map<string, string>()
  private approvalRevision = 0

  create(jobDescription: string, response: LocalSearchResponse, job?: JobSessionContext): SearchResponse {
    this.prune()
    while (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value as string | undefined
      if (!oldest) break
      this.deleteSession(oldest)
    }

    const id = randomUUID()
    const canonical = structuredClone(response)
    this.sessions.set(id, { id, jobDescription, response: canonical, createdAt: Date.now(), job: job ? structuredClone(job) : undefined })
    return { ...structuredClone(canonical), sessionId: id }
  }

  get(id: string): SearchSession {
    this.prune()
    const session = this.sessions.get(id)
    if (!session) throw new Error('This search result has expired. Run the search again.')
    return session
  }

  issueApproval(sessionId: string, requestBody: JsonObject, authContext = ''): string {
    this.get(sessionId)

    // A new preview supersedes the previous one for this search. Keeping both
    // would let repeated preview clicks accumulate live capabilities and would
    // leave an older payload approvable after the user reviewed a newer one.
    const previous = this.approvalBySession.get(sessionId)
    if (previous) this.deleteApproval(previous)

    while (this.approvals.size >= MAX_PENDING_APPROVALS) {
      const oldest = this.approvals.keys().next().value as string | undefined
      if (!oldest) break
      this.deleteApproval(oldest)
    }

    const token = randomUUID()
    this.approvals.set(token, {
      sessionId,
      requestDigest: requestDigest(requestBody, authContext),
      expiresAt: Date.now() + APPROVAL_TTL_MS
    })
    this.approvalBySession.set(sessionId, token)
    return token
  }

  consumeApproval(token: string | undefined, sessionId: string, requestBody: JsonObject, authContext = ''): void {
    if (!token) throw new Error('Review the exact AI request before approving it.')
    const approval = this.approvals.get(token)
    this.deleteApproval(token)
    if (
      !approval ||
      approval.expiresAt < Date.now() ||
      approval.sessionId !== sessionId ||
      approval.requestDigest !== requestDigest(requestBody, authContext)
    ) {
      throw new Error('The AI approval is missing, expired, or does not match this request.')
    }
  }

  clear(): void {
    this.sessions.clear()
    this.clearApprovals()
  }

  /** Settings can revoke outbound approval without throwing away local matches. */
  clearApprovals(): void {
    this.approvalRevision++
    this.approvals.clear()
    this.approvalBySession.clear()
  }

  getApprovalRevision(): number { return this.approvalRevision }

  clearJob(jobId: string): void {
    for (const [id, session] of this.sessions) {
      if (session.job?.jobId === jobId) this.deleteSession(id)
    }
  }

  private deleteApproval(token: string): void {
    const approval = this.approvals.get(token)
    this.approvals.delete(token)
    if (approval && this.approvalBySession.get(approval.sessionId) === token) {
      this.approvalBySession.delete(approval.sessionId)
    }
  }

  private deleteSession(id: string): void {
    this.sessions.delete(id)
    const token = this.approvalBySession.get(id)
    if (token) this.deleteApproval(token)
  }

  private prune(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (session.createdAt + SESSION_TTL_MS < now) this.deleteSession(id)
    }
    for (const [token, approval] of this.approvals) {
      if (approval.expiresAt < now || !this.sessions.has(approval.sessionId)) {
        this.deleteApproval(token)
      }
    }
  }
}

export const searchSessions = new SearchSessionStore()
