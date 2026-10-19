/** Turns a resume file into plain text. Dispatches on extension. */
import { extname, basename, join } from 'node:path'
import { crc32, createInflateRaw } from 'node:zlib'
import {
  EXTRACTION_TIMEOUT_MS,
  EXTRACTION_WORKER_HEAP_MB,
  type FromExtractionWorker,
  type ToExtractionWorker
} from './extraction-protocol.js'
import {
  readValidatedFileSource,
  validateFileSource,
  type ValidatedFileSource
} from './source-file.js'

import { MAX_EXTRACTED_TEXT_CHARS } from './extraction-protocol.js'
export { MAX_EXTRACTED_TEXT_CHARS, MAX_SOURCE_FILE_BYTES } from './extraction-protocol.js'

type FileType = 'pdf' | 'docx' | 'md'

/** A PDF yielding less than this many characters is almost certainly a scan. */
const SCANNED_TEXT_THRESHOLD = 100
const MAX_DOCX_EXPANDED_BYTES = 64 * 1024 * 1024
const MAX_DOCX_ENTRIES = 2_048

const FILE_TYPES: Readonly<Record<string, FileType>> = { '.pdf': 'pdf', '.docx': 'docx', '.md': 'md', '.markdown': 'md' }
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(FILE_TYPES)

export interface Extracted {
  text: string
  fileType: FileType
  likelyScanned: boolean
}

export function isSupported(path: string): boolean {
  return fileTypeOf(path) !== null
}

function fileTypeOf(path: string): FileType | null {
  return FILE_TYPES[extname(path).toLowerCase()] ?? null
}

async function extractInWorker(
  buf: Buffer,
  type: ToExtractionWorker['type']
): Promise<string> {
  const [{ utilityProcess }, { getEntryDir }] = await Promise.all([
    import('electron'),
    import('../embed/client.js')
  ])
  const child = utilityProcess.fork(join(getEntryDir(), 'extraction-worker.js'), [], {
    serviceName: 'cv-filter-document-extractor',
    execArgv: [
      `--max-old-space-size=${EXTRACTION_WORKER_HEAP_MB}`,
      '--max-semi-space-size=8'
    ],
    stdio: 'ignore'
  })

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, text?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.kill()
      if (error) reject(error)
      else resolve(text ?? '')
    }
    const timeout = setTimeout(
      () => finish(new Error('Document extraction exceeded Qumaa\'s 20-second safety limit.')),
      EXTRACTION_TIMEOUT_MS
    )

    child.once('spawn', () => {
      try {
        const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
        child.postMessage({
          type,
          data,
          maxCharacters: MAX_EXTRACTED_TEXT_CHARS
        } satisfies ToExtractionWorker)
      } catch {
        finish(new Error('Could not start safe document extraction.'))
      }
    })
    child.on('message', (message: unknown) => {
      if (typeof message !== 'object' || message === null || !('type' in message)) {
        finish(new Error('Document extraction returned an invalid response.'))
        return
      }
      const response = message as FromExtractionWorker
      if (response.type === 'error' && typeof response.message === 'string') {
        finish(new Error(response.message))
        return
      }
      if (
        response.type === 'result' &&
        typeof response.text === 'string' &&
        response.text.length <= MAX_EXTRACTED_TEXT_CHARS
      ) {
        finish(undefined, response.text)
        return
      }
      finish(new Error('Document extraction returned an invalid response.'))
    })
    child.once('error', () => finish(new Error('Safe document extraction process failed.')))
    child.once('exit', (code) => {
      if (!settled) {
        finish(
          new Error(
            code === 0
              ? 'Document extraction ended without a result.'
              : 'Document exceeded Qumaa\'s extraction safety limits or is malformed.'
          )
        )
      }
    })
  })
}

async function extractPdf(buf: Buffer): Promise<string> {
  return extractInWorker(buf, 'extract-pdf')
}

async function extractDocx(buf: Buffer): Promise<string> {
  const verifiedArchive = await prepareSafeDocxArchive(buf)
  return extractInWorker(verifiedArchive, 'extract-docx')
}

interface ZipEntry {
  name: Buffer
  flags: number
  method: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
  dataOffset?: number
  dataEnd?: number
  recordEnd?: number
}

const ZIP_LOCAL_HEADER = 0x04034b50
const ZIP_CENTRAL_HEADER = 0x02014b50
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50
const ZIP_DATA_DESCRIPTOR = 0x08074b50
const ZIP64_EXTRA_FIELD = 0x0001
const ZIP_ALLOWED_FLAGS = 0x080e // UTF-8, data descriptor, and deflate tuning bits.

function archiveError(message: string): Error {
  return new Error(`DOCX archive ${message}`)
}

function assertValidExtraFields(buffer: Buffer, start: number, end: number): void {
  let offset = start
  while (offset < end) {
    if (offset + 4 > end) throw archiveError('contains malformed ZIP extra data.')
    const fieldId = buffer.readUInt16LE(offset)
    const fieldSize = buffer.readUInt16LE(offset + 2)
    offset += 4
    if (offset + fieldSize > end) throw archiveError('contains malformed ZIP extra data.')
    if (fieldId === ZIP64_EXTRA_FIELD) {
      throw archiveError('uses an unsupported ZIP64 entry.')
    }
    offset += fieldSize
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumEocd = 22
  const searchStart = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - minimumEocd; offset >= searchStart; offset--) {
    if (
      buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY &&
      offset + minimumEocd + buffer.readUInt16LE(offset + 20) === buffer.length
    ) {
      return offset
    }
  }
  throw archiveError('is missing its central directory.')
}

function readCentralDirectory(buffer: Buffer): {
  entries: ZipEntry[]
  centralOffset: number
  eocd: number
} {
  const eocd = findEndOfCentralDirectory(buffer)
  const diskNumber = buffer.readUInt16LE(eocd + 4)
  const centralDisk = buffer.readUInt16LE(eocd + 6)
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8)
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    entryCount > MAX_DOCX_ENTRIES ||
    centralOffset + centralSize !== eocd
  ) {
    throw archiveError('is too large, split across disks, or uses an unsupported ZIP64 layout.')
  }

  let offset = centralOffset
  let declaredExpandedBytes = 0
  const entries: ZipEntry[] = []
  const localOffsets = new Set<number>()
  const names = new Set<string>()

  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_HEADER) {
      throw archiveError('central directory is malformed.')
    }
    const requiredVersion = buffer.readUInt16LE(offset + 6)
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const checksum = buffer.readUInt32LE(offset + 16)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const startingDisk = buffer.readUInt16LE(offset + 34)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength

    if (recordEnd > centralOffset + centralSize || nameLength === 0) {
      throw archiveError('central directory is malformed.')
    }
    if (
      requiredVersion > 20 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      startingDisk !== 0
    ) {
      throw archiveError('uses an unsupported ZIP64 or split-disk entry.')
    }
    if ((flags & ~ZIP_ALLOWED_FLAGS) !== 0 || (method !== 0 && method !== 8)) {
      throw archiveError('contains an encrypted or unsupported ZIP entry.')
    }
    if (method === 0 && (flags & 0x0006) !== 0) {
      throw archiveError('contains invalid compression flags.')
    }

    const nameStart = offset + 46
    const extraStart = nameStart + nameLength
    const entryName = buffer.subarray(nameStart, extraStart)
    assertValidExtraFields(buffer, extraStart, extraStart + extraLength)

    const nameKey = entryName.toString('hex')
    if (localOffsets.has(localOffset) || names.has(nameKey)) {
      throw archiveError('contains duplicate or overlapping entries.')
    }
    localOffsets.add(localOffset)
    names.add(nameKey)

    declaredExpandedBytes += uncompressedSize
    if (declaredExpandedBytes > MAX_DOCX_EXPANDED_BYTES) {
      throw archiveError("expands beyond Qumaa's 64 MB safety limit.")
    }

    entries.push({
      name: Buffer.from(entryName),
      flags,
      method,
      crc: checksum,
      compressedSize,
      uncompressedSize,
      localOffset
    })
    offset = recordEnd
  }
  if (offset !== centralOffset + centralSize) {
    throw archiveError('central directory is malformed.')
  }
  return { entries, centralOffset, eocd }
}

function readLocalEntries(buffer: Buffer, entries: ZipEntry[], centralOffset: number): void {
  const ordered = [...entries].sort((a, b) => a.localOffset - b.localOffset)

  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index]
    const boundary = ordered[index + 1]?.localOffset ?? centralOffset
    const offset = entry.localOffset
    if (offset + 30 > boundary || buffer.readUInt32LE(offset) !== ZIP_LOCAL_HEADER) {
      throw archiveError('contains a malformed local entry header.')
    }

    const requiredVersion = buffer.readUInt16LE(offset + 4)
    const flags = buffer.readUInt16LE(offset + 6)
    const method = buffer.readUInt16LE(offset + 8)
    const localCrc = buffer.readUInt32LE(offset + 14)
    const localCompressedSize = buffer.readUInt32LE(offset + 18)
    const localUncompressedSize = buffer.readUInt32LE(offset + 22)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const extraStart = nameStart + nameLength
    const dataOffset = extraStart + extraLength
    const dataEnd = dataOffset + entry.compressedSize

    if (
      requiredVersion > 20 ||
      flags !== entry.flags ||
      method !== entry.method ||
      dataOffset > boundary ||
      dataEnd > boundary ||
      nameLength !== entry.name.length ||
      !buffer.subarray(nameStart, extraStart).equals(entry.name)
    ) {
      throw archiveError('local and central entry metadata do not match.')
    }
    assertValidExtraFields(buffer, extraStart, dataOffset)

    let recordEnd = dataEnd
    if ((flags & 0x0008) === 0) {
      if (
        localCrc !== entry.crc ||
        localCompressedSize !== entry.compressedSize ||
        localUncompressedSize !== entry.uncompressedSize
      ) {
        throw archiveError('local and central entry metadata do not match.')
      }
    } else {
      if (
        (localCrc !== 0 && localCrc !== entry.crc) ||
        (localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize) ||
        (localUncompressedSize !== 0 && localUncompressedSize !== entry.uncompressedSize)
      ) {
        throw archiveError('local and central entry metadata do not match.')
      }

      let descriptorOffset = dataEnd
      if (descriptorOffset + 4 <= boundary && buffer.readUInt32LE(descriptorOffset) === ZIP_DATA_DESCRIPTOR) {
        descriptorOffset += 4
      }
      if (
        descriptorOffset + 12 > boundary ||
        buffer.readUInt32LE(descriptorOffset) !== entry.crc ||
        buffer.readUInt32LE(descriptorOffset + 4) !== entry.compressedSize ||
        buffer.readUInt32LE(descriptorOffset + 8) !== entry.uncompressedSize
      ) {
        throw archiveError('contains a malformed ZIP data descriptor.')
      }
      recordEnd = descriptorOffset + 12
    }

    if (recordEnd > boundary) throw archiveError('contains overlapping ZIP entries.')
    entry.dataOffset = dataOffset
    entry.dataEnd = dataEnd
    entry.recordEnd = recordEnd
  }
}

async function verifyEntryContents(
  buffer: Buffer,
  entry: ZipEntry,
  expandedSoFar: number
): Promise<number> {
  const compressed = buffer.subarray(entry.dataOffset, entry.dataEnd)
  let expandedSize = 0
  let checksum = 0

  const account = (chunk: Buffer): void => {
    expandedSize += chunk.byteLength
    if (
      expandedSize > entry.uncompressedSize ||
      expandedSoFar + expandedSize > MAX_DOCX_EXPANDED_BYTES
    ) {
      throw archiveError("expands beyond Qumaa's 64 MB safety limit or its declared size.")
    }
    checksum = crc32(chunk, checksum)
  }

  if (entry.method === 0) {
    account(compressed)
  } else {
    const inflater = createInflateRaw()
    inflater.end(compressed)
    try {
      for await (const chunk of inflater) account(chunk as Buffer)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('DOCX archive ')) throw error
      throw archiveError('contains malformed compressed data.')
    }
  }

  if (
    expandedSize !== entry.uncompressedSize ||
    expandedSize + expandedSoFar > MAX_DOCX_EXPANDED_BYTES ||
    checksum !== entry.crc
  ) {
    throw archiveError('entry contents do not match their size or checksum metadata.')
  }
  return expandedSoFar + expandedSize
}

/**
 * Validates ZIP metadata and bounded, actual decompression before Mammoth parses a DOCX.
 * No expanded entry content is retained in memory. The returned copy omits the
 * archive comment so JSZip consumes the same central directory that was checked:
 * JSZip otherwise selects the last EOCD signature, including one inside a comment.
 */
async function prepareSafeDocxArchive(buffer: Buffer): Promise<Buffer> {
  const { entries, centralOffset, eocd } = readCentralDirectory(buffer)
  readLocalEntries(buffer, entries, centralOffset)

  let expandedBytes = 0
  for (const entry of entries) {
    expandedBytes = await verifyEntryContents(buffer, entry, expandedBytes)
  }

  const verifiedArchive = Buffer.from(buffer.subarray(0, eocd + 22))
  verifiedArchive.writeUInt16LE(0, eocd + 20)
  return verifiedArchive
}

async function extractFileUnqueued(
  path: string,
  validatedSource?: ValidatedFileSource
): Promise<Extracted> {
  const fileType = fileTypeOf(path)
  if (!fileType) throw new Error(`Unsupported file type: ${basename(path)}`)

  const source = validatedSource ?? (await validateFileSource(path))
  const buf = await readValidatedFileSource(source)
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

  if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
    throw new Error('Resume text exceeds Qumaa\'s 500,000 character safety limit.')
  }

  // Only PDFs can silently produce an empty extraction (image-only scans).
  const likelyScanned = fileType === 'pdf' && text.trim().length < SCANNED_TEXT_THRESHOLD

  return { text, fileType, likelyScanned }
}

// A compromised renderer can submit multiple imports concurrently. Keep file
// reads and parser workers serial so 25 MB buffers cannot accumulate in main.
let extractionQueue: Promise<void> = Promise.resolve()

function enqueueExtraction(run: () => Promise<Extracted>): Promise<Extracted> {
  // The queue promise never rejects, so the next job starts whatever happened before it.
  const result = extractionQueue.then(run)
  extractionQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

export function extractFile(path: string): Promise<Extracted> {
  return enqueueExtraction(() => extractFileUnqueued(path))
}

/** Watched-folder path whose canonical identity was already validated. */
export function extractValidatedFile(source: ValidatedFileSource): Promise<Extracted> {
  return enqueueExtraction(() => extractFileUnqueued(source.canonicalPath, source))
}
