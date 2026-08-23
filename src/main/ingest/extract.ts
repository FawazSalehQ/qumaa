/** Turns a resume file into plain text. Dispatches on extension. */
import { readFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import type { FileType } from '@shared/types.js'

/** A PDF yielding less than this many characters is almost certainly a scan. */
const SCANNED_TEXT_THRESHOLD = 100

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown'] as const

export interface Extracted {
  text: string
  fileType: FileType
  likelyScanned: boolean
}

export function isSupported(path: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extname(path).toLowerCase())
}

export function fileTypeOf(path: string): FileType | null {
  switch (extname(path).toLowerCase()) {
    case '.pdf':
      return 'pdf'
    case '.docx':
      return 'docx'
    case '.txt':
      return 'txt'
    case '.md':
    case '.markdown':
      return 'md'
    default:
      return null
  }
}

async function extractPdf(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const { text } = await extractText(pdf, { mergePages: true })
  return Array.isArray(text) ? text.join('\n') : text
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default
  const { value } = await mammoth.extractRawText({ buffer: buf })
  return value
}

export async function extractFile(path: string): Promise<Extracted> {
  const fileType = fileTypeOf(path)
  if (!fileType) throw new Error(`Unsupported file type: ${basename(path)}`)

  const buf = await readFile(path)
  let text: string

  switch (fileType) {
    case 'pdf':
      text = await extractPdf(buf)
      break
    case 'docx':
      text = await extractDocx(buf)
      break
    default:
      text = buf.toString('utf8')
  }

  // Only PDFs can silently produce an empty extraction (image-only scans);
  // an empty .txt is just an empty file.
  const likelyScanned = fileType === 'pdf' && text.trim().length < SCANNED_TEXT_THRESHOLD

  return { text, fileType, likelyScanned }
}
