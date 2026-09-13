/**
 * Runtime validation for every value crossing from the sandboxed renderer.
 *
 * TypeScript disappears at runtime. A compromised renderer can invoke any
 * exposed channel with arbitrary values, so main must reject malformed,
 * oversized, or surprising payloads before they reach the filesystem, SQLite,
 * PDF renderer, or the optional Anthropic boundary.
 */
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { isRerankConfig } from '../shared/rerank.js'

const MAX_PATH = 4_096
const MAX_LABEL = 512
const MAX_JOB_TEXT = 100_000
const MAX_RESUME_TEXT = 500_000
const MAX_RESULTS = 50
const opaqueToken = z.string().uuid()

const boundedString = (max: number): z.ZodString => z.string().max(max)
const textLabel = boundedString(MAX_LABEL)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'must not contain control characters')
  .trim()
const absolutePath = boundedString(MAX_PATH)
  .min(1)
  .refine(isAbsolute, 'must be an absolute path')
const resumeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const recordKey = z.string().regex(/^[a-f0-9]{64}$/)
const resumeRef = z.object({ id: resumeId, recordKey })
const score = z.number().finite().min(0).max(1)

const resumeSummary = z.object({
  id: resumeId,
  recordKey,
  fileName: boundedString(MAX_LABEL),
  filePath: boundedString(MAX_PATH),
  importedAt: z.number().int().nonnegative(),
  name: boundedString(MAX_LABEL).nullable(),
  email: boundedString(512).nullable(),
  phone: boundedString(128).nullable(),
  location: boundedString(MAX_LABEL).nullable(),
  yearsExperience: z.number().finite().min(0).max(100).nullable(),
  educationLevel: z.enum(['phd', 'masters', 'bachelors', 'associate']).nullable(),
  skills: z.array(boundedString(256)).max(512)
})

const matchResult = z.object({
  llmReason: boundedString(1_000).optional(),
  resume: resumeSummary,
  score,
  breakdown: z.object({ semantic: score, lexical: score, skills: score }),
  matchedSkills: z.array(boundedString(256)).max(512),
  missingSkills: z.array(boundedString(256)).max(512),
  evidence: z
    .array(
      z.object({
        section: z.enum(['summary', 'experience', 'education', 'skills', 'projects', 'other']),
        text: boundedString(20_000),
        similarity: z.number().finite().min(-1).max(1)
      })
    )
    .max(100)
})

export const ipcSchemas = {
  resumeId,
  resumeRef,
  resumeRefs: z
    .array(resumeRef)
    .min(1)
    .max(5_000)
    .refine(
      (refs) => new Set(refs.map(({ id, recordKey }) => `${id}:${recordKey}`)).size === refs.length,
      'must not contain duplicates'
    ),
  absolutePath,
  resumePaths: z.array(absolutePath).min(1).max(5_000),
  ingestText: z.object({
    text: boundedString(MAX_RESUME_TEXT).trim().min(1),
    label: textLabel
  }),
  jobDescription: boundedString(MAX_JOB_TEXT).trim().min(1),
  exportArgs: z.object({
    jobTitle: boundedString(MAX_LABEL).trim(),
    requiredSkills: z.array(boundedString(256)).max(512),
    results: z.array(matchResult).min(1).max(MAX_RESULTS)
  }),
  rerankPreviewArgs: z.object({
    sessionId: opaqueToken
  }),
  rerankArgs: z.object({
    sessionId: opaqueToken,
    approvalToken: opaqueToken.optional()
  }),
  apiKey: boundedString(4_096).trim().min(1).nullable(),
  rerankProvider: z.enum(['anthropic', 'openai']),
  rerankConfig: z.object({
    provider: z.enum(['anthropic', 'openai']),
    model: boundedString(128).min(1)
  }).strict().refine(isRerankConfig, 'must choose a supported model for the provider'),
  enabled: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']),
  language: z.enum(['en', 'ar']),
  watchedFolder: z.null()
} as const

/**
 * Produces a concise error without echoing candidate text, paths, or secrets
 * into logs or a renderer-visible exception.
 */
export function parseIpc<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data

  const issue = parsed.error.issues[0]
  const location = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : ''
  throw new Error(`Invalid ${label}${location}: ${issue.message}`)
}
