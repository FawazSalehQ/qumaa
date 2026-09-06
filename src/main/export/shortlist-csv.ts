import type { MatchResult } from '@shared/types.js'

/** Quoting handles delimiters; the apostrophe keeps spreadsheet formulas inert. */
function cell(value: string | number | null): string {
  let text = value === null ? '' : String(value)
  if (/^[\s]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function shortlistCsv(args: {
  jobTitle: string
  results: MatchResult[]
  notes?: Record<string, string>
}): string {
  const rows: Array<Array<string | number | null>> = [
    ['Position', 'Shortlist order', 'Candidate', 'Email', 'Phone', 'Location', 'Experience (years)',
      'Education', 'Match score', 'Matched skills', 'Skills not detected', 'Recruiter notes']
  ]
  args.results.forEach((result, index) => {
    const resume = result.resume
    rows.push([
      args.jobTitle, index + 1, resume.name ?? resume.fileName, resume.email, resume.phone,
      resume.location, resume.yearsExperience, resume.educationLevel,
      Math.round(result.score * 100), result.matchedSkills.join('; '),
      result.missingSkills.join('; '), args.notes?.[resume.recordKey] ?? ''
    ])
  })
  // UTF-8 BOM lets desktop Excel recognize Arabic without an import wizard.
  return '\ufeff' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
