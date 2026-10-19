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
import { isRerankConfig, RERANK_PROVIDERS } from '../shared/rerank.js'

const MAX_PATH = 4_096
const MAX_LABEL = 512
const MAX_RESUME_TEXT = 500_000

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

export const ipcSchemas = {
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
  apiKey: boundedString(4_096).trim().min(1).nullable(),
  rerankProvider: z.enum(RERANK_PROVIDERS),
  rerankConfig: z.object({
    provider: z.enum(RERANK_PROVIDERS),
    model: boundedString(128),
    authMode: z.enum(['api-key', 'chatgpt']).optional()
  }).strict().refine(isRerankConfig, 'must choose a supported model for the provider'),
  chatGptAccountId: z.string().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/),
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
