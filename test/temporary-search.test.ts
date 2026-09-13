import { describe, expect, it } from 'vitest'
import { TemporarySearchStore } from '../src/main/recruiting/temporary.js'
import type { JobRecord, SnapshotRecord } from '../src/main/recruiting/schema.js'

const job: JobRecord = {
  id: '7348f3cf-95c4-4b6c-88fd-98080ee3c455',
  posting: { position: 'Temporary engineer search', jobDescription: '', requirements: '', educationAndCertifications: '' },
  criteria: [], status: 'open', createdAt: 1, updatedAt: 1, lastSearchedAt: 1
}
const snapshot: SnapshotRecord = {
  jobId: job.id, libraryFingerprint: 'a'.repeat(64), postingFingerprint: 'b'.repeat(64), modelFingerprint: 'c'.repeat(64),
  searchedAt: 1, libraryKeys: [], requiredSkills: [], elapsedMs: 1, results: []
}

describe('temporary search lifetime', () => {
  it('keeps an isolated memory copy and starts empty in a new process store', () => {
    const store = new TemporarySearchStore()
    store.publish(store.begin(), { job, snapshot })
    const returned = store.get(job.id)!
    returned.job.posting.position = 'Changed by caller'
    expect(store.get(job.id)!.job.posting.position).toBe(job.posting.position)
    expect(new TemporarySearchStore().get(job.id)).toBeNull()
  })

  it('rejects older completions and prevents discard from resurrecting a search', () => {
    const store = new TemporarySearchStore()
    const first = store.begin()
    const second = store.begin()
    expect(() => store.publish(first, { job, snapshot })).toThrow('changed')
    store.publish(second, { job, snapshot })
    const pending = store.begin()
    expect(store.discard(job.id)).toBe(true)
    expect(() => store.publish(pending, { job, snapshot })).toThrow('changed')
    expect(store.id).toBeNull()
  })

  it('does not let an obsolete discard remove a newer search', () => {
    const store = new TemporarySearchStore()
    store.publish(store.begin(), { job, snapshot })
    expect(store.discard('33785d3d-a911-44d5-a3ad-b5dcf1e5f10')).toBe(false)
    expect(store.get(job.id)).not.toBeNull()
    store.clear()
    expect(store.get(job.id)).toBeNull()
  })

  it('removes deleted CV identities and their generated reasons from temporary results', () => {
    const store = new TemporarySearchStore()
    const key = 'd'.repeat(64)
    const other = 'e'.repeat(64)
    const result = (recordKey: string) => ({ recordKey, score: 1, breakdown: { semantic: 1, lexical: 1, skills: 1 }, matchedSkills: [], missingSkills: [], evidence: [] })
    store.publish(store.begin(), { job, snapshot: { ...snapshot, libraryKeys: [key, other], results: [result(key), result(other)], rerank: [{ recordKey: key, reason: 'Private deleted explanation' }, { recordKey: other }] } })
    store.prune(new Set([other]))
    expect(store.get(job.id)!.snapshot.results.map((entry) => entry.recordKey)).toEqual([other])
    expect(store.get(job.id)!.snapshot.rerank).toBeUndefined()
    expect(store.get(job.id)!.snapshot.libraryKeys).toEqual([key, other])
  })
})
