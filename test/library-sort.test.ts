import { describe, expect, it } from 'vitest'
import type { ResumeSummary } from '../src/shared/types.js'
import { compareResumes, type LibrarySortKey } from '../src/renderer/src/librarySort.js'

function resume(id: number, overrides: Partial<ResumeSummary> = {}): ResumeSummary {
  return {
    id,
    recordKey: id.toString(16).padStart(64, '0'),
    fileName: `${id}.pdf`,
    filePath: `/${id}.pdf`,
    importedAt: id,
    name: `Candidate ${id}`,
    email: null,
    phone: null,
    location: null,
    yearsExperience: id,
    educationLevel: 'bachelors',
    skills: [],
    ...overrides
  }
}

function sortedIds(
  values: ResumeSummary[],
  key: LibrarySortKey,
  ascending: boolean
): number[] {
  return [...values]
    .sort((a, b) => compareResumes(a, b, key, ascending))
    .map((value) => value.id)
}

describe('library resume sorting', () => {
  it.each([
    [
      'name',
      [resume(1, { name: 'Bravo' }), resume(2, { name: null }), resume(3, { name: 'Alpha' })],
      [3, 1, 2],
      [1, 3, 2]
    ],
    [
      'years',
      [
        resume(1, { yearsExperience: 2 }),
        resume(2, { yearsExperience: null }),
        resume(3, { yearsExperience: 10 })
      ],
      [1, 3, 2],
      [3, 1, 2]
    ],
    [
      'education',
      [
        resume(1, { educationLevel: 'bachelors' }),
        resume(2, { educationLevel: null }),
        resume(3, { educationLevel: 'phd' })
      ],
      [1, 3, 2],
      [3, 1, 2]
    ]
  ] as const)(
    'keeps missing %s values last in both directions',
    (key, values, ascending, descending) => {
      expect(sortedIds([...values], key, true)).toEqual(ascending)
      expect(sortedIds([...values], key, false)).toEqual(descending)
    }
  )

  it('sorts import time in both directions', () => {
    const values = [resume(2), resume(1), resume(3)]

    expect(sortedIds(values, 'imported', true)).toEqual([1, 2, 3])
    expect(sortedIds(values, 'imported', false)).toEqual([3, 2, 1])
  })
})
