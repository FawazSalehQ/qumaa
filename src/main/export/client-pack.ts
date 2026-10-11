import { criterionImportanceLabel } from '@shared/job-requirements.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { directionFor, localeFor, translate, type Language } from '@shared/i18n.js'
import type { ClientPackConfig, ClientPackDocument, ClientPackSource } from '@shared/client-pack.js'
import type { JobWorkspace } from '@shared/recruiting.js'
import type { TalentOverview } from '@shared/talent.js'

const text = (max: number) => z.string().max(max).refine((value) => !value.includes('\0'), 'must not contain NUL characters')
const identifier = z.string().min(1).max(150).regex(/^[a-zA-Z0-9:_-]+$/)
const unique = (values: string[]): boolean => new Set(values).size === values.length
export const clientPackConfigSchema = z.strictObject({
  jobId: z.string().uuid(),
  firmName: text(200), introduction: text(2000), blind: z.boolean(), includeCriteria: z.boolean(),
  candidates: z.array(z.strictObject({
    personId: z.string().uuid(), recommendation: text(3000),
    includeContact: z.boolean(), includeCompensation: z.boolean(), includeAvailability: z.boolean(),
    evidenceIds: z.array(identifier).max(3).refine(unique, 'evidence must be unique'),
    answerIds: z.array(identifier).max(10).refine(unique, 'screening answers must be unique')
  })).min(1).max(10).refine((values) => unique(values.map((value) => value.personId)), 'candidates must be unique')
})

const excerpt = (value: string, max: number): string => value.length > max ? `${value.slice(0, max)}…` : value
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Initial picker is small; only the selected people receive evidence/answer choices. */
export function clientPackSourceFromRecords(workspace: JobWorkspace, talent: TalentOverview, selectedIds?: string[]): ClientPackSource {
  if (workspace.temporary) throw new Error('Save the job before preparing a client presentation.')
  if (selectedIds && (selectedIds.length > 10 || !unique(selectedIds))) throw new Error('Choose up to ten distinct people for a client presentation.')
  const assigned = new Set(talent.assignments.filter((assignment) => assignment.jobId === workspace.job.id).map((assignment) => assignment.personId))
  const people = talent.people.filter((person) => assigned.has(person.id))
  if (selectedIds?.some((id) => !people.some((person) => person.id === id))) throw new Error('A selected person is no longer assigned to this job. Refresh the pack.')
  return {
    jobId: workspace.job.id,
    jobTitle: workspace.job.posting.position || workspace.job.posting.jobDescription.split('\n')[0] || 'Untitled job',
    criteria: workspace.job.criteria.map(({ text: value, importance }) => ({ text: value, importance })),
    candidates: (selectedIds ? selectedIds.map((id) => people.find((person) => person.id === id)!) : people).map((person) => {
      const profile = workspace.profiles.find((item) => item.recordKeys.some((key) => person.recordKeys.includes(key)))
      const full = selectedIds !== undefined
      const evidence = full ? (workspace.response?.results ?? [])
        .filter((match) => person.recordKeys.includes(match.resume.recordKey))
        .flatMap((match) => match.evidence.map((item) => ({ id: digest(`${match.resume.recordKey}:${item.section}:${item.text}`), section: item.section, text: excerpt(item.text, 1600) })))
        .filter((item, index, all) => all.findIndex((entry) => entry.id === item.id) === index).slice(0, 12) : []
      const answers = full ? talent.screenings.filter((screening) => screening.personId === person.id && screening.jobId === workspace.job.id)
        .flatMap((screening) => screening.questions.filter((question) => question.answer.trim()).map((question) => ({
          id: `${screening.id}:${question.id}`, question: excerpt(question.question, 1000), answer: excerpt(question.answer, 4000),
          verification: question.verification === 'verified' ? 'recruiter-verified' as const : question.verification
        }))).slice(0, 50) : []
      return {
        personId: person.id, name: person.name,
        // Contact fields are copied from the profile when the person is first
        // created. Later blanks are recruiter edits, not missing fallback data.
        email: full ? person.email : '', phone: full ? person.phone : '',
        expectedSalary: full ? profile?.expectedSalary ?? '' : '', availability: full ? person.availability : '',
        noticePeriod: full ? profile?.noticePeriod ?? '' : '', evidence, answers
      }
    })
  }
}

/** Only selected canonical data crosses into the client-facing document. */
export function projectClientPack(source: ClientPackSource, input: ClientPackConfig, language: Language, generatedAt: number): ClientPackDocument {
  const config = clientPackConfigSchema.parse(input)
  if (config.jobId !== source.jobId) throw new Error('This client pack belongs to a different job.')
  return {
    language, generatedAt, jobTitle: source.jobTitle, firmName: config.firmName, introduction: config.introduction,
    blind: config.blind, criteria: config.includeCriteria ? source.criteria.map(({ text: value, importance }) => ({ text: value, importance })) : [],
    candidates: config.candidates.map((selection, index) => {
      const candidate = source.candidates.find((item) => item.personId === selection.personId)
      if (!candidate) throw new Error('A selected person is no longer assigned to this job. Refresh the pack.')
      const evidence = selection.evidenceIds.map((id) => {
        const item = candidate.evidence.find((entry) => entry.id === id)
        if (!item) throw new Error('Selected CV evidence changed. Refresh the pack.')
        return { section: item.section, text: item.text }
      })
      const answers = selection.answerIds.map((id) => {
        const item = candidate.answers.find((entry) => entry.id === id)
        if (!item) throw new Error('A selected screening answer changed. Refresh the pack.')
        return { question: item.question, answer: item.answer, verification: item.verification }
      })
      const contact: ClientPackDocument['candidates'][number]['contact'] = []
      const details: ClientPackDocument['candidates'][number]['details'] = []
      if (!config.blind && selection.includeContact) {
        if (candidate.email) contact.push({ label: 'Email', value: candidate.email })
        if (candidate.phone) contact.push({ label: 'Phone', value: candidate.phone })
      }
      if (selection.includeCompensation && candidate.expectedSalary) details.push({ label: 'Expected salary (recruiter recorded)', value: candidate.expectedSalary })
      if (selection.includeAvailability) {
        if (candidate.availability) details.push({ label: 'Availability (recruiter recorded)', value: candidate.availability })
        if (candidate.noticePeriod) details.push({ label: 'Notice period (recruiter recorded)', value: candidate.noticePeriod })
      }
      return {
        label: config.blind ? translate(language, 'Candidate {count}', { count: index + 1 }) : candidate.name || translate(language, 'Candidate {count}', { count: index + 1 }),
        recommendation: selection.recommendation, contact, details, evidence, answers
      }
    })
  }
}

export function clientPackFingerprint(document: ClientPackDocument): string {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex')
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Pure markup, with no remote assets or scripts; every variable is escaped. */
export function clientPackHtml(document: ClientPackDocument): string {
  const t = (message: string): string => esc(translate(document.language, message))
  const value = (content: string): string => `<bdi dir="auto">${esc(content)}</bdi>`
  const date = new Intl.DateTimeFormat(localeFor(document.language), { year: 'numeric', month: 'long', day: 'numeric' }).format(document.generatedAt)
  return `<!doctype html><html lang="${document.language}" dir="${directionFor(document.language)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:"><style>
    @page { margin: 18mm 16mm; } * { box-sizing: border-box; }
    body { font-family: 'Qumaa PDF Arabic', 'IBM Plex Sans', system-ui, sans-serif; color: #2b2733; font-size: 10.5pt; line-height: 1.55; margin: 0; text-align: start; }
    .brand { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 2px solid #6d3fb0; margin-bottom: 20px; }
    .brand strong { font-size: 19pt; } .brand span { margin-inline-start: auto; color: #6b6577; font-size: 9pt; }
    h1 { font-size: 20pt; line-height: 1.2; margin: 5px 0; } h2 { font-size: 17pt; margin: 0 0 12px; } h3 { font-size: 10pt; color: #6d3fb0; margin: 17px 0 5px; }
    p { margin: 4px 0 10px; } .eyebrow { color: #6d3fb0; font-size: 9pt; } .muted { color: #6b6577; font-size: 9pt; }
    .candidate { break-before: page; } .candidate:first-of-type { break-before: auto; margin-top: 25px; }
    .facts { display: flex; flex-wrap: wrap; gap: 12px 24px; margin: 14px 0; padding: 12px; background: #f4f1f8; }
    .facts div { flex: 1 1 180px; } .facts dt { color: #6b6577; font-size: 8.5pt; } .facts dd { margin: 2px 0 0; }
    .quote { border-inline-start: 3px solid #c0a3ea; padding-inline-start: 12px; margin: 10px 0; }
    .answer { border-bottom: 1px solid #e4dff0; padding: 9px 0; } .verification { display: block; color: #6b6577; font-size: 8.5pt; }
    .pre { white-space: pre-wrap; } p, h1, h2, h3, li, dd, bdi { overflow-wrap: anywhere; } bdi { unicode-bidi: isolate; }
    footer { border-top: 1px solid #e4dff0; margin-top: 20px; padding-top: 10px; color: #6b6577; font-size: 8pt; }
  </style></head><body>
    <header class="brand"><strong lang="ar" dir="rtl">قُمع</strong>${document.firmName ? `<b>${value(document.firmName)}</b>` : ''}<span>${esc(date)}</span></header>
    <p class="eyebrow">${t('Client presentation')}</p><h1 dir="auto">${esc(document.jobTitle)}</h1>
    ${document.introduction ? `<p class="pre" dir="auto">${esc(document.introduction)}</p>` : ''}
    ${document.blind ? `<p class="muted">${t('Candidate names and contact fields are hidden. Selected free text may still identify a person.')}</p>` : ''}
    ${document.criteria.length ? `<h3>${t('Requirements')}</h3><ul>${document.criteria.map((criterion) => `<li>${value(criterion.text)} <span class="muted">(${t(criterionImportanceLabel(criterion.importance))})</span></li>`).join('')}</ul>` : ''}
    ${document.candidates.map((candidate, index) => `<article class="candidate"><p class="eyebrow">${esc(translate(document.language, 'Candidate {count}', { count: index + 1 }))}</p><h2 dir="auto">${esc(candidate.label)}</h2>
      ${candidate.contact.length ? `<p class="muted">${candidate.contact.map((field) => value(field.value)).join(' · ')}</p>` : ''}
      ${candidate.recommendation ? `<h3>${t('Recruiter recommendation')}</h3><p class="pre" dir="auto">${esc(candidate.recommendation)}</p>` : ''}
      ${candidate.details.length ? `<dl class="facts">${candidate.details.map((field) => `<div><dt>${t(field.label)}</dt><dd>${value(field.value)}</dd></div>`).join('')}</dl>` : ''}
      ${candidate.evidence.length ? `<h3>${t('Selected CV evidence')}</h3>${candidate.evidence.map((evidence) => `<blockquote class="quote"><span class="verification">${t(evidence.section)} · ${t('Candidate CV; not independently verified')}</span><p class="pre" dir="auto">${esc(evidence.text)}</p></blockquote>`).join('')}` : ''}
      ${candidate.answers.length ? `<h3>${t('Selected screening answers')}</h3>${candidate.answers.map((answer) => `<section class="answer"><strong dir="auto">${esc(answer.question)}</strong><p class="pre" dir="auto">${esc(answer.answer)}</p><span class="verification">${t(answer.verification === 'recruiter-verified' ? 'Recruiter verified' : answer.verification === 'candidate-stated' ? 'Candidate stated; not independently verified' : 'Unverified screening answer')}</span></section>`).join('')}` : ''}
    </article>`).join('')}
    <footer>${t('Selected and ordered by the recruiter. Only the fields shown in this presentation are included.')}</footer>
  </body></html>`
}
