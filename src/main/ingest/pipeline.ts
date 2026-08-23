/**
 * The single ingest path. Drag-and-drop, bulk folder import, the folder watcher,
 * and pasted text all funnel through `ingestText`, so dedupe and field extraction
 * behave identically no matter how a resume arrived.
 */
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { getDb, findByHash, rowToSummary, vectorToBlob, type ResumeRow } from '../db/index.js'
import { embedder } from '../embed/client.js'
import { extractFile, isSupported, type Extracted } from './extract.js'
import { normalizeText, flatten } from './normalize.js'
import { splitSections } from './sections.js'
import { chunkSections } from './chunk.js'
import { extractFields } from './fields.js'
import type { FileType, IngestOutcome } from '@shared/types.js'

function hashText(text: string): string {
  return createHash('sha256').update(flatten(text)).digest('hex')
}

/**
 * Ingests already-extracted text. Returns `duplicate` without touching the model
 * when the content hash is already present. This is what makes re-importing a
 * folder cheap and what stops the watcher from re-adding files.
 */
export async function ingestText(args: {
  text: string
  fileName: string
  filePath: string
  fileType: FileType
  likelyScanned?: boolean
}): Promise<IngestOutcome> {
  const normalized = normalizeText(args.text)
  if (!normalized.trim()) {
    return { status: 'failed', fileName: args.fileName, reason: 'No text could be extracted' }
  }

  const hash = hashText(normalized)
  const existing = findByHash(hash)
  if (existing) {
    return { status: 'duplicate', fileName: args.fileName, existingId: existing.id }
  }

  const sections = splitSections(normalized)
  const chunks = chunkSections(sections)
  if (chunks.length === 0) {
    return { status: 'failed', fileName: args.fileName, reason: 'Document too short to index' }
  }

  const fields = extractFields(normalized, sections)
  const vectors = await embedder.embedPassages(chunks.map((c) => c.text))

  const db = getDb()
  // One transaction: a resume is never half-indexed, so a crash mid-import
  // cannot leave a row whose chunks are missing from search.
  const insert = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO resumes (file_path, file_name, content_hash, file_type, imported_at, raw_text,
                              name, email, phone, location, years_experience, education_level,
                              skills_json, likely_scanned)
         VALUES (@file_path, @file_name, @content_hash, @file_type, @imported_at, @raw_text,
                 @name, @email, @phone, @location, @years_experience, @education_level,
                 @skills_json, @likely_scanned)`
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
        likely_scanned: args.likelyScanned ? 1 : 0
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

  const id = insert()
  const row = db.prepare('SELECT * FROM resumes WHERE id = ?').get(id) as ResumeRow
  return { status: 'imported', resume: rowToSummary(row) }
}

export async function ingestFile(path: string): Promise<IngestOutcome> {
  const fileName = basename(path)
  if (!isSupported(path)) {
    return { status: 'unsupported', fileName, reason: 'Only PDF, DOCX, TXT and MD are supported' }
  }

  let extracted: Extracted
  try {
    extracted = await extractFile(path)
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
    fileType: extracted.fileType,
    likelyScanned: extracted.likelyScanned
  })
}

/** Recursively collects supported resume files, skipping hidden directories. */
export async function collectFiles(dir: string, acc: string[] = []): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFiles(full, acc)
    } else if (entry.isFile() && isSupported(full)) {
      acc.push(full)
    }
  }
  return acc
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
