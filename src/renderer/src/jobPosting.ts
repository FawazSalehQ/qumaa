import type { JobPosting } from '@shared/recruiting.js'
export type { JobPosting } from '@shared/recruiting.js'

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
