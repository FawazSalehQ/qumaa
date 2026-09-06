import type { JobPosting } from '@shared/recruiting.js'
export type { JobPosting } from '@shared/recruiting.js'

export type JobPostingField = keyof JobPosting

export function emptyJobPosting(): JobPosting {
  return {
    position: '',
    jobDescription: '',
    requirements: '',
    educationAndCertifications: ''
  }
}

export function hasJobPostingContent(posting: JobPosting): boolean {
  return Object.values(posting).some((value) => value.trim().length > 0)
}

/**
 * The proven local search pipeline deliberately continues to accept one string.
 * Only user-authored values enter that query: UI headings would otherwise leak
 * generic words into FTS and could become synthetic semantic requirements.
 */
export function formatJobPosting(posting: JobPosting): string {
  const sections = [
    posting.position,
    posting.jobDescription,
    posting.requirements,
    posting.educationAndCertifications
  ]

  return sections.map((value) => value.trim()).filter(Boolean).join('\n\n')
}

/** Position is the stable result label; older title-less workflows still get a useful fallback. */
export function jobPostingTitle(posting: JobPosting): string {
  const source =
    posting.position.trim() ||
    [posting.jobDescription, posting.requirements, posting.educationAndCertifications]
      .flatMap((value) => value.split('\n'))
      .map((line) => line.trim())
      .find(Boolean) ||
    'Job description'

  return source.length > 80 ? `${source.slice(0, 80)}…` : source
}
