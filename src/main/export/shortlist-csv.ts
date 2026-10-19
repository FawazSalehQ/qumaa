import { translate, type Language } from '@shared/i18n.js'
import { EDUCATION_LABELS, type MatchResult } from '@shared/types.js'
import { csvCell } from './csv.js'

export function shortlistCsv(args: {
  jobTitle: string
  results: MatchResult[]
  notes?: Record<string, string>
}, language: Language = 'en'): string {
  const t = (message: string): string => translate(language, message)
  const rows: Array<Array<string | number | null>> = [
    ['Position', 'Shortlist order', 'Candidate', 'Email', 'Phone', 'Location', 'Experience (years)',
      'Education', 'Match score', 'Matched skills', 'Skills not detected', 'Recruiter notes'].map(t)
  ]
  args.results.forEach((result, index) => {
    const resume = result.resume
    rows.push([
      args.jobTitle, index + 1, resume.name ?? resume.fileName, resume.email, resume.phone,
      resume.location, resume.yearsExperience, resume.educationLevel ? t(EDUCATION_LABELS[resume.educationLevel]) : null,
      Math.round(result.score * 100), result.matchedSkills.join('; '),
      result.missingSkills.join('; '), args.notes?.[resume.recordKey] ?? ''
    ])
  })
  // Numeric cells stay machine-readable in both languages for spreadsheet sorting.
  // UTF-8 BOM lets desktop Excel recognize Arabic without an import wizard.
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
