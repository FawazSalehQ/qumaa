import { describe, expect, it } from 'vitest'
import {
  MAX_PENDING_APPROVALS,
  SearchSessionStore
} from '../src/main/search/sessions.js'

const response = {
  results: [],
  requiredSkills: ['TypeScript'],
  totalCandidates: 0,
  elapsedMs: 3
}

describe('main-owned search sessions', () => {
  it('keeps an immutable canonical copy instead of trusting renderer mutations', () => {
    const store = new SearchSessionStore()
    const returned = store.create('Senior engineer', response)
    returned.requiredSkills.push('INJECTED')

    expect(store.get(returned.sessionId).response.requiredSkills).toEqual(['TypeScript'])
    expect(store.get(returned.sessionId).jobDescription).toBe('Senior engineer')
  })

  it('binds a one-use approval token to the session and exact request body', () => {
    const store = new SearchSessionStore()
    const first = store.create('First', response)
    const second = store.create('Second', response)
    const body = { messages: [{ role: 'user', content: 'exact payload' }] }
    const token = store.issueApproval(first.sessionId, body)

    expect(() =>
      store.consumeApproval(token, first.sessionId, {
        messages: [{ role: 'user', content: 'mutated payload' }]
      })
    ).toThrow('does not match')

    const secondToken = store.issueApproval(first.sessionId, body)
    expect(() => store.consumeApproval(secondToken, second.sessionId, body)).toThrow(
      'does not match'
    )

    const validToken = store.issueApproval(first.sessionId, body)
    expect(() => store.consumeApproval(validToken, first.sessionId, body)).not.toThrow()
    expect(() => store.consumeApproval(validToken, first.sessionId, body)).toThrow()
  })

  it('keeps only the newest preview approval for a search session', () => {
    const store = new SearchSessionStore()
    const session = store.create('Senior engineer', response)
    const firstBody = { messages: [{ role: 'user', content: 'first preview' }] }
    const secondBody = { messages: [{ role: 'user', content: 'second preview' }] }
    const firstToken = store.issueApproval(session.sessionId, firstBody)
    const secondToken = store.issueApproval(session.sessionId, secondBody)

    expect(() => store.consumeApproval(firstToken, session.sessionId, firstBody)).toThrow(
      'missing, expired, or does not match'
    )
    expect(() => store.consumeApproval(secondToken, session.sessionId, secondBody)).not.toThrow()
  })

  it('enforces a hard global cap on pending preview approvals', () => {
    const store = new SearchSessionStore()
    const issued = Array.from({ length: MAX_PENDING_APPROVALS + 1 }, (_, index) => {
      const session = store.create(`Search ${index}`, response)
      const body = { messages: [{ role: 'user', content: `preview ${index}` }] }
      return {
        sessionId: session.sessionId,
        body,
        token: store.issueApproval(session.sessionId, body)
      }
    })

    const oldest = issued[0]
    expect(() => store.consumeApproval(oldest.token, oldest.sessionId, oldest.body)).toThrow(
      'missing, expired, or does not match'
    )

    const newest = issued[issued.length - 1]
    expect(() => store.consumeApproval(newest.token, newest.sessionId, newest.body)).not.toThrow()
  })
})
