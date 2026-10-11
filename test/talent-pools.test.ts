import { describe, expect, it } from 'vitest'
import { EMPTY_TALENT_FILTERS, newPoolPeople, peopleInPool, type Person, type TalentPool } from '../src/shared/talent.js'

const person = (id: string, fields: Partial<Person> = {}): Person => ({ id, name: id, email: '', phone: '', employer: '', title: '', location: 'Riyadh', skills: [], tags: [], availability: '', availabilityConfirmedAt: null, sourceUrl: '', note: '', recordKeys: [], origin: 'prospect', createdAt: 1, updatedAt: 1, ...fields })
const savedSearch: TalentPool = { id: 'search', name: 'Platform engineers', note: '', mode: 'search', filters: { ...EMPTY_TALENT_FILTERS, skill: 'TypeScript' }, members: [{ personId: 'reviewed', addedAt: 20 }], lastReviewedAt: 20, createdAt: 1, updatedAt: 20 }

describe('saved-search review membership', () => {
  it('flags an existing prospect who newly matches after an edit, without flagging routine edits to a reviewed match', () => {
    const reviewed = person('reviewed', { skills: ['TypeScript'], note: 'Updated recruiter note', updatedAt: 30 })
    const changed = person('changed', { skills: ['TypeScript'], updatedAt: 30 })
    const noMatch = person('not-matching', { updatedAt: 30 })
    const matches = peopleInPool(savedSearch, [reviewed, changed, noMatch], [])
    expect(matches).toEqual([reviewed, changed])
    expect(newPoolPeople(savedSearch, matches)).toEqual([changed])
  })

  it('flags an older prospect who becomes eligible after linking a CV', () => {
    const pool = { ...savedSearch, filters: { ...EMPTY_TALENT_FILTERS, hasCv: 'yes' as const }, members: [] }
    const before = person('older-prospect')
    expect(peopleInPool(pool, [before], [])).toEqual([])
    const after = { ...before, recordKeys: ['a'.repeat(64)], updatedAt: 30 }
    expect(newPoolPeople(pool, peopleInPool(pool, [after], []))).toEqual([after])
  })

  it('clears new matches after review and retains separate addition dates for curated pools', () => {
    const candidate = person('changed', { skills: ['TypeScript'] })
    expect(newPoolPeople({ ...savedSearch, members: [...savedSearch.members, { personId: candidate.id, addedAt: 30 }], lastReviewedAt: 30 }, [candidate])).toEqual([])
    const manual = { ...savedSearch, mode: 'manual' as const, members: [{ personId: candidate.id, addedAt: 30 }] }
    expect(newPoolPeople(manual, [candidate])).toEqual([candidate])
    expect(newPoolPeople({ ...manual, lastReviewedAt: 30 }, [candidate])).toEqual([])
  })
})
