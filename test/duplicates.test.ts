import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeRow {
  id: number
  name: string | null
  email: string | null
  phone: string | null
  fileName: string
  doc_vector: Float32Array
}

const fakeDb = vi.hoisted(() => ({ rows: [] as FakeRow[] }))

// duplicates.ts normally imports the Electron-ABI better-sqlite3 module. Mock
// that seam so these tests exercise the pure rule and query orchestration in
// ordinary Node, just like the secrets tests do.
vi.mock('../src/main/db/index.js', () => ({
  blobToVector: (value: Float32Array): Float32Array => value,
  getDb: () => ({
    prepare: () => ({
      all: () => fakeDb.rows
    })
  })
}))

const {
  CONTACT_IDENTITY_THRESHOLD,
  NAME_IDENTITY_THRESHOLD,
  NO_IDENTITY_THRESHOLD,
  decideNearDuplicate,
  findNearDuplicate,
  normalizeIdentityEmail,
  normalizeIdentityName,
  normalizeIdentityPhone
} = await import('../src/main/ingest/duplicates.js')

const identity = (
  name: string | null,
  email: string | null,
  phone: string | null
): { name: string | null; email: string | null; phone: string | null } => ({
  name,
  email,
  phone
})

const NONE = identity(null, null, null)

describe('identity normalization', () => {
  it('normalizes email case and surrounding whitespace', () => {
    expect(normalizeIdentityEmail('  Jane.Doe@Example.COM\n')).toBe('jane.doe@example.com')
  })

  it('rejects blank and malformed emails', () => {
    expect(normalizeIdentityEmail('')).toBeNull()
    expect(normalizeIdentityEmail('not-an-email')).toBeNull()
  })

  it('normalizes phone formatting and an international dial prefix', () => {
    expect(normalizeIdentityPhone('+966 (50) 123-4567')).toBe('966501234567')
    expect(normalizeIdentityPhone('00966 50 123 4567')).toBe('966501234567')
  })

  it('rejects numbers too short to identify a person reliably', () => {
    expect(normalizeIdentityPhone('555-1234')).toBeNull()
  })

  it('normalizes case, accents, punctuation, and whitespace in names', () => {
    expect(normalizeIdentityName('  JOSÉ   O’Connor-Smith ')).toBe('jose o connor smith')
  })

  it('normalizes Arabic diacritics, tatweel, and alef variants', () => {
    expect(normalizeIdentityName('أَحْمَــد  عَلِى')).toBe('احمد علي')
  })

  it('does not trust a one-token name as identity', () => {
    expect(normalizeIdentityName('Mohammed')).toBeNull()
  })
})

describe('decideNearDuplicate', () => {
  it('accepts a close document with the same normalized email', () => {
    const candidate = identity('Jane Doe', 'JANE@example.com', null)
    const existing = identity('Jane D.', 'jane@example.com', null)
    expect(decideNearDuplicate(CONTACT_IDENTITY_THRESHOLD, candidate, existing)).toEqual({
      duplicate: true,
      basis: 'email'
    })
  })

  it('accepts local and international formatting of the same phone', () => {
    const candidate = identity('Jane Doe', null, '050 123 4567')
    const existing = identity('Jane Doe', null, '+966 50 123 4567')
    expect(decideNearDuplicate(0.97, candidate, existing)).toEqual({
      duplicate: true,
      basis: 'phone'
    })
  })

  it('accepts a very close document with the same full name', () => {
    const candidate = identity('José O’Connor', null, null)
    const existing = identity('JOSE O-CONNOR', null, null)
    expect(decideNearDuplicate(NAME_IDENTITY_THRESHOLD, candidate, existing)).toEqual({
      duplicate: true,
      basis: 'name'
    })
  })

  it('lets one matching strong signal survive another changed contact field', () => {
    const candidate = identity('Jane Doe', 'new@example.com', '+1 212 555 0199')
    const existing = identity('Jane Doe', 'old@example.com', '+1 212 555 0199')
    expect(decideNearDuplicate(0.98, candidate, existing).basis).toBe('phone')
  })

  it('does not let a shared phone override different reliable full names', () => {
    const shatha = identity(
      'Shatha Al-Mousa',
      'shatha.almousa@example.com',
      '+966 55 000 3392'
    )
    const ingrid = identity(
      'Ingrid Solberg',
      'ingrid.solberg@example.com',
      '+966 55 000 3392'
    )

    expect(decideNearDuplicate(0.965, shatha, ingrid)).toEqual({
      duplicate: false,
      basis: null
    })
  })

  it('requires document similarity even when contact identity matches', () => {
    const sameEmail = identity('Jane Doe', 'jane@example.com', null)
    expect(
      decideNearDuplicate(CONTACT_IDENTITY_THRESHOLD - 0.001, sameEmail, sameEmail)
    ).toEqual({ duplicate: false, basis: null })
  })

  it('uses the stricter threshold for a name-only match', () => {
    const sameName = identity('Jane Doe', null, null)
    expect(decideNearDuplicate(NAME_IDENTITY_THRESHOLD - 0.001, sameName, sameName)).toEqual({
      duplicate: false,
      basis: null
    })
  })

  it('rejects even near-identical professional text when identities differ', () => {
    const candidate = identity('Jane Doe', 'jane@example.com', '+1 212 555 0101')
    const existing = identity('Janet Roe', 'janet@example.com', '+1 212 555 0102')
    expect(decideNearDuplicate(0.9999, candidate, existing)).toEqual({
      duplicate: false,
      basis: null
    })
  })

  it('allows a very-high cosine fallback only when identity cannot be compared', () => {
    const onlyCandidateHasIdentity = identity('Jane Doe', 'jane@example.com', null)
    expect(decideNearDuplicate(NO_IDENTITY_THRESHOLD, onlyCandidateHasIdentity, NONE)).toEqual({
      duplicate: true,
      basis: 'document'
    })
  })

  it('rejects document-only similarity below the fallback threshold', () => {
    expect(decideNearDuplicate(NO_IDENTITY_THRESHOLD - 0.001, NONE, NONE)).toEqual({
      duplicate: false,
      basis: null
    })
  })

  it('rejects non-finite similarity', () => {
    expect(decideNearDuplicate(Number.NaN, NONE, NONE)).toEqual({
      duplicate: false,
      basis: null
    })
  })
})

describe('findNearDuplicate', () => {
  const unitVector = (similarity: number): Float32Array =>
    new Float32Array([similarity, Math.sqrt(1 - similarity * similarity)])

  beforeEach(() => {
    fakeDb.rows = []
  })

  it('returns the closest eligible identity-aware match, not a closer conflicting person', () => {
    fakeDb.rows = [
      {
        id: 1,
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: null,
        fileName: 'jane-old.pdf',
        doc_vector: unitVector(0.98)
      },
      {
        id: 2,
        name: 'Janet Roe',
        email: 'janet@example.com',
        phone: null,
        fileName: 'janet.pdf',
        doc_vector: unitVector(0.9999)
      }
    ]

    const match = findNearDuplicate(
      new Float32Array([1, 0]),
      identity('Jane Doe', 'JANE@example.com', null)
    )

    expect(match).toMatchObject({ id: 1, fileName: 'jane-old.pdf' })
    expect(match?.similarity).toBeCloseTo(0.98)
  })
})
