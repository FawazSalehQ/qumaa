import { describe, expect, it } from 'vitest'
import {
  emptyJobPosting,
  hasJobPostingContent,
  jobPostingTitle,
  type JobPosting
} from '../src/renderer/src/jobPosting.js'
import { parseRequirements } from '../src/main/search/scoring.js'
import { postingText } from '../src/main/recruiting/planning.js'

function posting(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    position: 'Senior Accountant',
    jobDescription: 'Own monthly close and financial reporting.',
    requirements: 'Five years of accounting experience\nAdvanced Excel modelling skills',
    educationAndCertifications: "Bachelor's degree in accounting\nCPA certification preferred",
    ...overrides
  }
}

describe('structured job posting', () => {
  it('joins trimmed user values in field order without synthetic headings', () => {
    expect(
      postingText(
        posting({
          position: '  Senior Accountant  ',
          jobDescription: '\nOwn monthly close.\n',
          requirements: '  Advanced Excel skills  ',
          educationAndCertifications: '  CPA preferred\n'
        })
      )
    ).toBe(
      'Senior Accountant\n\nOwn monthly close.\n\nAdvanced Excel skills\n\nCPA preferred'
    )
  })

  it.each([
    ['position', 'مدير تدريب المطاعم'],
    ['jobDescription', 'يقود برامج تدريب الموظفين'],
    ['requirements', 'خبرة في إدارة فرق متعددة'],
    ['educationAndCertifications', 'شهادة معتمدة في سلامة الغذاء']
  ] as const)('allows %s to be the only populated field', (field, value) => {
    const valueOnly = { ...emptyJobPosting(), [field]: `  ${value}  ` }

    expect(hasJobPostingContent(valueOnly)).toBe(true)
    expect(postingText(valueOnly)).toBe(value)
  })

  it('treats an entirely blank posting as empty', () => {
    const blank = {
      position: ' ',
      jobDescription: '\n',
      requirements: '\t',
      educationAndCertifications: '  '
    }

    expect(hasJobPostingContent(blank)).toBe(false)
    expect(postingText(blank)).toBe('')
  })

  it('keeps substantive requirement and education lines available to semantic parsing', () => {
    const requirements = parseRequirements(
      postingText(
        posting({
          requirements: 'Manage Kubernetes production clusters',
          educationAndCertifications: "Bachelor's degree in computer science"
        })
      )
    )

    expect(requirements).toContain('Manage Kubernetes production clusters')
    expect(requirements).toContain("Bachelor's degree in computer science")
    expect(requirements).not.toContain('Education and Certifications')
  })

  it('uses Position as the title, then falls back through the other fields', () => {
    expect(jobPostingTitle(posting())).toBe('Senior Accountant')
    expect(
      jobPostingTitle(
        posting({ position: ' ', jobDescription: '\nFirst useful description line\nSecond line' })
      )
    ).toBe('First useful description line')
    expect(jobPostingTitle(emptyJobPosting())).toBe('Job description')
  })

  it('truncates a long position consistently', () => {
    expect(jobPostingTitle(posting({ position: 'x'.repeat(81) }))).toBe(`${'x'.repeat(80)}…`)
  })
})
