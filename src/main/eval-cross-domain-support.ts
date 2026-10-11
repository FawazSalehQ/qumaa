/** Evaluation contracts and aggregation only; never imported by production ranking. */
import { z } from 'zod'
import { rankingMetrics, type RelevanceTier } from './eval-support.js'

const nonempty = z.string().trim().min(1)
const slug = z.string().regex(/^[a-z][a-z0-9-]*$/)
const bilingual = z.strictObject({ en: nonempty, ar: nonempty })
const tier = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
export const familySchema = z.strictObject({
  schemaVersion: z.literal(1), family: slug, title: nonempty,
  reviewStatus: z.literal('synthetic-unreviewed'),
  candidates: z.array(z.strictObject({ id: z.string().regex(/^C\d+$/), ...bilingual.shape })).min(8),
  vacancies: z.array(z.strictObject({
    id: slug, seniority: nonempty, posting: bilingual,
    labels: z.record(z.string(), tier), rationales: z.record(z.string(), nonempty)
  })).min(2)
}).superRefine((family, context) => {
  const ids = family.candidates.map((candidate) => candidate.id)
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Duplicate career identity.' })
  if (new Set(family.vacancies.map((vacancy) => vacancy.id)).size !== family.vacancies.length) context.addIssue({ code: 'custom', message: 'Duplicate vacancy identity.' })
  for (const vacancy of family.vacancies) {
    for (const field of ['labels', 'rationales'] as const) {
      if (Object.keys(vacancy[field]).length !== ids.length || ids.some((id) => !Object.hasOwn(vacancy[field], id))) {
        context.addIssue({ code: 'custom', message: `${vacancy.id}: ${field} must cover exactly the candidate identities.` })
      }
    }
    if (Object.values(vacancy.labels).filter((label) => label === 1).length < 3) context.addIssue({ code: 'custom', message: 'Each vacancy requires at least three strong-fit reference careers.' })
  }
})
export type EvaluationFamily = z.infer<typeof familySchema>
export type Cohort = 'mixed-a' | 'mixed-b' | 'english' | 'arabic'
export type Language = 'en' | 'ar'
export const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1), id: slug,
  families: z.array(z.strictObject({ family: slug, split: z.enum(['development', 'reserved']) })).min(2)
}).superRefine((value, context) => {
  if (new Set(value.families.map((family) => family.family)).size !== value.families.length) context.addIssue({ code: 'custom', message: 'Duplicate family in manifest.' })
  if (!value.families.some((family) => family.split === 'reserved')) context.addIssue({ code: 'custom', message: 'Reserve at least one family.' })
})

export function careerLanguage(index: number, cohort: Cohort): Language {
  if (cohort === 'english') return 'en'
  if (cohort === 'arabic') return 'ar'
  return (index % 2 === 0) === (cohort === 'mixed-a') ? 'en' : 'ar'
}

export type QualityMetrics = ReturnType<typeof rankingMetrics>
export interface MetricCase {
  id: string; family: string; vacancy: string; language: Language; cohort: Cohort
  metrics: QualityMetrics
}
const METRICS = ['precisionAt3', 'recallAt3', 'recallAt10', 'top3TargetCoverage', 'reciprocalRank', 'mrr', 'ndcg10'] as const
function meanMetrics(cases: Array<{ metrics: QualityMetrics }>): QualityMetrics {
  if (!cases.length) throw new Error('Cannot aggregate an empty evaluation.')
  return Object.fromEntries(METRICS.map((key) => [key, cases.reduce((sum, item) => sum + item.metrics[key], 0) / cases.length])) as QualityMetrics
}
/** Equal weight per vacancy, regardless of language/cohort repetition count. */
export function macroMetrics(cases: MetricCase[]): QualityMetrics {
  if (new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error('Duplicate evaluation case.')
  const vacancies = new Map<string, MetricCase[]>()
  for (const item of cases) {
    const key = `${item.family}/${item.vacancy}`
    vacancies.set(key, [...vacancies.get(key) ?? [], item])
  }
  return meanMetrics([...vacancies.values()].map((items) => ({ metrics: meanMetrics(items) })))
}

/** Per-language recall uses relevant CVs in that language as its denominator. */
export function languageRecall(ranking: Array<{ tier: RelevanceTier; language: Language }>, language: Language) {
  const relevant = ranking.filter((candidate) => candidate.language === language && candidate.tier === 1).length
  const hits = (n: number) => ranking.slice(0, n).filter((candidate) => candidate.language === language && candidate.tier === 1).length
  return { relevant, hits3: hits(3), hits10: hits(10), recallAt3: relevant ? hits(3) / relevant : null, recallAt10: relevant ? hits(10) / relevant : null }
}
