/**
 * Canonical resume derivation shared by normal ingestion and portable restore.
 *
 * `raw_text` is the only resume content a portable backup is allowed to assert.
 * Everything that can influence matching or candidate identity is derived from
 * this function so restore cannot drift from the regular ingest path.
 */
import { createHash } from 'node:crypto'
import { MAX_EXTRACTED_TEXT_CHARS } from './extraction-protocol.js'
import { normalizeText, flatten } from './normalize.js'
import { splitSections } from './sections.js'
import { chunkSections } from './chunk.js'
import { extractFields } from './fields.js'

export function normalizeResumeText(input: string): string {
  if (input.length > MAX_EXTRACTED_TEXT_CHARS) {
    throw new Error("Resume text exceeds Qumaa's 500,000 character safety limit.")
  }
  if (input.includes('\0')) {
    throw new Error('Resume text contains an unsupported NUL character.')
  }

  const normalized = normalizeText(input)
  // Some Unicode compatibility substitutions expand to multiple ASCII
  // characters (for example, typographic ligatures), so enforce the same bound
  // again on the exact text that will be stored and embedded.
  if (normalized.length > MAX_EXTRACTED_TEXT_CHARS) {
    throw new Error("Resume text exceeds Qumaa's 500,000 character safety limit.")
  }
  if (!normalized.trim()) throw new Error('No text could be extracted')
  return normalized
}

/**
 * Text already stored as `raw_text` is canonical and identity-bearing. It is
 * checked, never transformed: normalizeText is not idempotent, so re-running it
 * would change the text and its hash and make a healthy library look corrupt.
 */
export function assertStoredResumeText(stored: string): string {
  if (stored.length > MAX_EXTRACTED_TEXT_CHARS) {
    throw new Error("Resume text exceeds Qumaa's 500,000 character safety limit.")
  }
  if (stored.includes('\0')) {
    throw new Error('Resume text contains an unsupported NUL character.')
  }
  if (!stored.trim()) throw new Error('No text could be extracted')
  return stored
}

export function resumeContentHash(normalizedText: string): string {
  return createHash('sha256').update(flatten(normalizedText)).digest('hex')
}

function deriveFromCanonical(normalized: string) {
  const sections = splitSections(normalized)
  const chunks = chunkSections(sections)
  if (chunks.length === 0) throw new Error('Document too short to index')

  return {
    normalized,
    contentHash: resumeContentHash(normalized),
    chunks,
    fields: extractFields(normalized, sections)
  }
}

/** Ingest path: raw extracted text is normalised once, then derived. */
export function deriveResumeText(input: string) {
  return deriveFromCanonical(normalizeResumeText(input))
}

/** Rebuild paths (parser upgrade, portable restore): stored text is derived as it is. */
export function deriveStoredResumeText(stored: string) {
  return deriveFromCanonical(assertStoredResumeText(stored))
}
