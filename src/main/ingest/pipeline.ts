/**
 * The single ingest path. Drag-and-drop, bulk folder import, the folder watcher,
 * and pasted text all funnel through `ingestText`, so dedupe and field extraction
 * behave identically no matter how a resume arrived.
 */
import { basename } from 'node:path'
import { opendir } from 'node:fs/promises'
import type { Dir } from 'node:fs'
import { join } from 'node:path'
import {
  getDb,
  findByHash,
  recordResumeInserted,
  RESUME_ROW_COLUMNS,
  resumeCapacityError,
  rowToSummary,
  vectorToBlob,
  type ResumeRow
} from '../db/index.js'
import { embedder } from '../embed/client.js'
import { documentVector, findNearDuplicate } from './duplicates.js'
import {
  extractFile,
  extractValidatedFile,
  isSupported,
  type Extracted
} from './extract.js'
import type { ValidatedFileSource } from './source-file.js'
import { deriveResumeText } from './derive.js'
import { DATABASE_LIMITS } from '../db/migrations.js'
import { SKILL_GAZETTEER_VERSION } from './skills-backfill-plan.js'
import type { IngestOutcome } from '@shared/types.js'

/**
 * Ingests already-extracted text. Returns `duplicate` without touching the model
 * when the content hash is already present. This is what makes re-importing a
 * folder cheap and what stops the watcher from re-adding files.
 */
export async function ingestText(args: {
  text: string
  fileName: string
  filePath: string
  fileType: Extracted['fileType'] | 'pasted'
}): Promise<IngestOutcome> {
  if (
    args.filePath.length > DATABASE_LIMITS.filePathChars ||
    args.filePath.includes('\0') ||
    args.fileName.length === 0 ||
    args.fileName.length > DATABASE_LIMITS.labelChars ||
    /[\u0000-\u001f\u007f]/.test(args.fileName)
  ) {
    return {
      status: 'failed',
      fileName:
        args.fileName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, DATABASE_LIMITS.labelChars) ||
        'Resume',
      reason: 'Resume source path or filename exceeds Qumaa\'s safety limit or contains control characters.'
    }
  }
  let derived: ReturnType<typeof deriveResumeText>
  try {
    derived = deriveResumeText(args.text)
  } catch (error) {
    return {
      status: 'failed',
      fileName: args.fileName,
      reason: error instanceof Error ? error.message : 'Could not process resume text'
    }
  }

  const { normalized, contentHash: hash, chunks, fields } = derived
  const existing = findByHash(hash)
  if (existing) {
    return { status: 'duplicate', fileName: args.fileName, existingId: existing.id }
  }
  const chunkTextChars = chunks.reduce((total, chunk) => total + chunk.text.length, 0)
  const initialCapacityError = resumeCapacityError(
    normalized.length,
    chunks.length,
    chunkTextChars
  )
  if (initialCapacityError) {
    return { status: 'failed', fileName: args.fileName, reason: initialCapacityError }
  }

  const vectors = await embedder.embedPassages(chunks.map((c) => c.text))

  // Checked before insert so the new resume cannot match itself.
  const docVector = documentVector(vectors)
  const similarTo = findNearDuplicate(docVector, {
    name: fields.name,
    email: fields.email,
    phone: fields.phone
  })

  const db = getDb()
  // One transaction: a resume is never half-indexed, so a crash mid-import
  // cannot leave a row whose chunks are missing from search.
  const insert = db.transaction((): number | string | { duplicate: number } => {
    // The embedding await above let another import of the same text land first.
    const raced = findByHash(hash)
    if (raced) return { duplicate: raced.id }
    const capacityError = resumeCapacityError(
      normalized.length,
      chunks.length,
      chunkTextChars
    )
    if (capacityError) return capacityError

    const res = db
      .prepare(
        `INSERT INTO resumes (file_path, file_name, content_hash, file_type, imported_at, raw_text,
                              name, email, phone, location, years_experience, education_level,
                              skills_json, skills_version, doc_vector)
         VALUES (@file_path, @file_name, @content_hash, @file_type, @imported_at, @raw_text,
                 @name, @email, @phone, @location, @years_experience, @education_level,
                 @skills_json, @skills_version, @doc_vector)`
      )
      .run({
        file_path: args.filePath,
        file_name: args.fileName,
        content_hash: hash,
        file_type: args.fileType,
        imported_at: Date.now(),
        raw_text: normalized,
        name: fields.name,
        email: fields.email,
        phone: fields.phone,
        location: fields.location,
        years_experience: fields.yearsExperience,
        education_level: fields.educationLevel,
        skills_json: JSON.stringify(fields.skills),
        skills_version: SKILL_GAZETTEER_VERSION,
        doc_vector: vectorToBlob(docVector)
      })

    const resumeId = Number(res.lastInsertRowid)
    const chunkStmt = db.prepare(
      'INSERT INTO chunks (resume_id, section, ordinal, text, embedding) VALUES (?, ?, ?, ?, ?)'
    )
    chunks.forEach((c, i) => {
      chunkStmt.run(resumeId, c.section, c.ordinal, c.text, vectorToBlob(vectors[i]))
    })
    return resumeId
  })

  const inserted = insert()
  if (typeof inserted === 'string') {
    return { status: 'failed', fileName: args.fileName, reason: inserted }
  }
  if (typeof inserted === 'object') {
    return { status: 'duplicate', fileName: args.fileName, existingId: inserted.duplicate }
  }
  const id = inserted
  recordResumeInserted(normalized.length, chunks.length, chunkTextChars)
  const row = db
    .prepare(`SELECT ${RESUME_ROW_COLUMNS} FROM resumes WHERE id = ?`)
    .get(id) as ResumeRow
  const resume = rowToSummary(row)
  // Imported either way: the user decides whether a near-duplicate is a second
  // application or a genuinely different person.
  return similarTo ? { status: 'near-duplicate', resume, similarTo } : { status: 'imported', resume }
}

async function ingestFileSource(
  path: string,
  validatedSource?: ValidatedFileSource
): Promise<IngestOutcome> {
  const fileName = basename(path)
  if (!isSupported(path)) {
    return { status: 'unsupported', fileName, reason: 'Only PDF, DOCX and Markdown are supported' }
  }

  let extracted: Extracted
  try {
    extracted = validatedSource
      ? await extractValidatedFile(validatedSource)
      : await extractFile(path)
  } catch (err) {
    return {
      status: 'failed',
      fileName,
      reason: err instanceof Error ? err.message : 'Could not read file'
    }
  }

  if (extracted.likelyScanned) {
    return {
      status: 'failed',
      fileName,
      reason: 'PDF appears to be a scan with no text layer (OCR not supported)'
    }
  }

  return ingestText({
    text: extracted.text,
    fileName,
    filePath: path,
    fileType: extracted.fileType
  })
}

export function ingestFile(path: string): Promise<IngestOutcome> {
  return ingestFileSource(path)
}

export function ingestValidatedFile(source: ValidatedFileSource): Promise<IngestOutcome> {
  return ingestFileSource(source.canonicalPath, source)
}

/** Recursively collects supported resume files, skipping hidden directories. */
export const MAX_FOLDER_FILES = 5_000
const MAX_FOLDER_DEPTH = 16
const MAX_FOLDER_ENTRIES = 50_000

export async function collectFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  let visitedEntries = 0

  const visit = async (current: string, depth: number): Promise<void> => {
    if (depth > MAX_FOLDER_DEPTH) {
      throw new Error(`Folder nesting exceeds Qumaa's ${MAX_FOLDER_DEPTH}-level safety limit.`)
    }
    let directory: Dir
    try {
      directory = await opendir(current)
    } catch {
      return
    }

    // Stream entries instead of materialising an attacker-sized directory.
    for await (const entry of directory) {
      if (++visitedEntries > MAX_FOLDER_ENTRIES) {
        throw new Error(`Folder traversal exceeds Qumaa's ${MAX_FOLDER_ENTRIES}-entry safety limit.`)
      }
      if (entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await visit(full, depth + 1)
      } else if (entry.isFile() && isSupported(full)) {
        if (files.length >= MAX_FOLDER_FILES) {
          throw new Error(`Folder contains more than ${MAX_FOLDER_FILES} supported resume files.`)
        }
        files.push(full)
      }
    }
  }

  await visit(dir, 0)
  return files
}
