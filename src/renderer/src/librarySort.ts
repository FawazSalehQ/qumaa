import type { ResumeSummary } from '@shared/types.js'

export type LibrarySortKey = 'name' | 'years' | 'education' | 'imported'

const EDUCATION_RANK = { phd: 4, masters: 3, bachelors: 2, associate: 1 } as const

/** Missing extracted fields stay at the bottom in both sort directions. */
function compareNullable<T>(
  a: T | null,
  b: T | null,
  ascending: boolean,
  compare: (left: T, right: T) => number
): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return (ascending ? 1 : -1) * compare(a, b)
}

export function compareResumes(
  a: ResumeSummary,
  b: ResumeSummary,
  key: LibrarySortKey,
  ascending: boolean
): number {
  switch (key) {
    case 'name':
      return compareNullable(a.name, b.name, ascending, (left, right) =>
        left.localeCompare(right)
      )
    case 'years':
      return compareNullable(
        a.yearsExperience,
        b.yearsExperience,
        ascending,
        (left, right) => left - right
      )
    case 'education':
      return compareNullable(
        a.educationLevel,
        b.educationLevel,
        ascending,
        (left, right) => EDUCATION_RANK[left] - EDUCATION_RANK[right]
      )
    case 'imported':
      return (ascending ? 1 : -1) * (a.importedAt - b.importedAt)
  }
}
