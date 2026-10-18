import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { crc32, deflateRawSync } from 'node:zlib'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import type { ToExtractionWorker } from '../src/main/ingest/extraction-protocol.js'
import {
  extractFile,
  isSupported,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_SOURCE_FILE_BYTES,
  SUPPORTED_EXTENSIONS
} from '../src/main/ingest/extract.js'

const { workerInputs } = vi.hoisted(() => ({ workerInputs: [] as Buffer[] }))

// Keep the production main-to-worker boundary and use Mammoth's actual ZIP
// consumer, without needing an Electron app for these archive regressions.
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const { default: workerMammoth } = await import('mammoth')
  return {
    utilityProcess: {
      fork: () => {
        const child = Object.assign(new EventEmitter(), {
          kill: vi.fn(),
          postMessage: (request: ToExtractionWorker) => {
            const buffer = Buffer.from(request.data)
            workerInputs.push(buffer)
            workerMammoth.extractRawText({ buffer }).then(
              ({ value }) => child.emit('message', { type: 'result', text: value }),
              () => child.emit('message', {
                type: 'error', message: 'Could not safely extract document text.'
              })
            )
          }
        })
        setImmediate(() => child.emit('spawn'))
        return child
      }
    }
  }
})
vi.mock('../src/main/embed/client.js', () => ({ getEntryDir: () => '/unused-test-worker' }))

const temporaryDirectories: string[] = []

afterEach(async () => {
  workerInputs.splice(0)
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

async function fixtureDocx(): Promise<Buffer> {
  return readFile(new URL('./fixtures/files/aisha-rahman.docx', import.meta.url))
}

function withArchiveComment(archive: Buffer, comment: Buffer): Buffer {
  const result = Buffer.concat([archive, comment])
  result.writeUInt16LE(comment.length, archive.length - 2)
  return result
}

function withHiddenDirectory(archive: Buffer): Buffer {
  const eocd = archive.length - 22
  const emptyDirectoryEnd = Buffer.alloc(22)
  emptyDirectoryEnd.writeUInt32LE(0x06054b50, 0)
  emptyDirectoryEnd.writeUInt32LE(eocd, 16)
  emptyDirectoryEnd.writeUInt16LE(23, 20)

  // Qumaa checks the empty directory; JSZip used to read the later EOCD inside
  // its comment. Its inflated central-size value suppresses JSZip's offset fix.
  const hiddenDirectoryEnd = Buffer.from(archive.subarray(eocd))
  hiddenDirectoryEnd.writeUInt32LE(hiddenDirectoryEnd.readUInt32LE(12) + 22, 12)
  return Buffer.concat([
    archive.subarray(0, eocd), emptyDirectoryEnd, hiddenDirectoryEnd, Buffer.alloc(1)
  ])
}

async function temporaryFile(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'qumaa-extract-'))
  temporaryDirectories.push(directory)
  return join(directory, name)
}

function zipWithLyingDeflateSize(contents: Buffer, declaredUncompressedSize: number): Buffer {
  const name = Buffer.from('word/document.xml')
  const compressed = deflateRawSync(contents)
  const checksum = crc32(contents)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(checksum, 14)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(declaredUncompressedSize, 22)
  local.writeUInt16LE(name.length, 26)

  const centralOffset = local.length + name.length + compressed.length
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(declaredUncompressedSize, 24)
  central.writeUInt16LE(name.length, 28)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + name.length, 12)
  end.writeUInt32LE(centralOffset, 16)

  return Buffer.concat([local, name, compressed, central, name, end])
}

describe('supported resume formats', () => {
  it('keeps the canonical format list scoped to supported digital documents', () => {
    expect(SUPPORTED_EXTENSIONS).toEqual(['.pdf', '.docx', '.md', '.markdown'])
  })

  it('accepts supported extensions case-insensitively', () => {
    expect(isSupported('/resumes/candidate.PDF')).toBe(true)
    expect(isSupported('/resumes/candidate.DOCX')).toBe(true)
    expect(isSupported('/resumes/candidate.MD')).toBe(true)
    expect(isSupported('/resumes/candidate.MARKDOWN')).toBe(true)
  })

  it('rejects text files and image-only formats', () => {
    expect(isSupported('/resumes/candidate.txt')).toBe(false)
    expect(isSupported('/resumes/candidate.png')).toBe(false)
  })

  it('rejects an oversized source before reading its contents', async () => {
    const path = await temporaryFile('oversized.md')
    await writeFile(path, '')
    await truncate(path, MAX_SOURCE_FILE_BYTES + 1)
    await expect(extractFile(path)).rejects.toThrow('25 MB source-file limit')
  })

  it('does not follow a symbolic-link resume source', async () => {
    const target = await temporaryFile('candidate-source.md')
    const link = join(target, '..', 'candidate-link.md')
    await writeFile(target, '# Candidate')
    await symlink(target, link)

    await expect(extractFile(link)).rejects.toThrow('non-symbolic-link file')
  })

  it('rejects a non-regular source without trying to read it', async () => {
    const path = await temporaryFile('directory.md')
    await mkdir(path)

    await expect(extractFile(path)).rejects.toThrow('non-symbolic-link file')
  })

  it('rejects extracted text above the per-resume limit', async () => {
    const path = await temporaryFile('oversized.md')
    await writeFile(path, 'x'.repeat(MAX_EXTRACTED_TEXT_CHARS + 1))
    await expect(extractFile(path)).rejects.toThrow('500,000 character safety limit')
  })

  it('streams DOCX entries and rejects actual expansion that exceeds declared metadata', async () => {
    const path = await temporaryFile('lying-size.docx')
    const archive = zipWithLyingDeflateSize(Buffer.alloc(2 * 1024 * 1024, 0x41), 1)
    await writeFile(path, archive)

    await expect(extractFile(path)).rejects.toThrow(/declared size|size or checksum metadata/)
    expect(workerInputs).toHaveLength(0)
  })

  it.each(['STORE', 'DEFLATE'] as const)(
    'preserves %s DOCX contents with and without data descriptors',
    async (compression) => {
      const original = await fixtureDocx()
      const expected = (await mammoth.extractRawText({ buffer: original })).value
      const zip = await JSZip.loadAsync(original)
      for (const streamFiles of [false, true]) {
        const archive = await zip.generateAsync({ type: 'nodebuffer', compression, streamFiles })
        const path = await temporaryFile('candidate.docx')
        await writeFile(path, archive)

        await expect(extractFile(path)).resolves.toMatchObject({ text: expected, fileType: 'docx' })
        expect(workerInputs.at(-1)).toEqual(archive)
      }
    }
  )

  it.each([
    Buffer.from('A normal archive comment'),
    Buffer.from('An ordinary comment containing PK\x05\x06 and trailing text')
  ])('strips archive comments before the downstream parser sees them (%s)', async (comment) => {
    const original = await fixtureDocx()
    const expected = (await mammoth.extractRawText({ buffer: original })).value
    const archive = withArchiveComment(original, comment)
    const path = await temporaryFile('commented.docx')
    await writeFile(path, archive)

    await expect(extractFile(path)).resolves.toMatchObject({ text: expected, fileType: 'docx' })
    expect(workerInputs).toEqual([original])
    expect(await readFile(path)).toEqual(archive)
  })

  it('does not let a second EOCD in a comment reveal an unchecked directory to Mammoth', async () => {
    const original = await fixtureDocx()
    const archive = withHiddenDirectory(original)
    const hiddenEntries = Object.keys((await JSZip.loadAsync(archive)).files)
    expect(hiddenEntries).toContain('word/document.xml')
    await expect(mammoth.extractRawText({ buffer: archive })).resolves.toMatchObject({
      value: (await mammoth.extractRawText({ buffer: original })).value
    })
    const path = await temporaryFile('ambiguous.docx')
    await writeFile(path, archive)

    await expect(extractFile(path)).rejects.toThrow('Could not safely extract document text.')
    expect(workerInputs).toHaveLength(1)
    const forwarded = workerInputs[0]
    expect(forwarded.length).toBe(original.length)
    expect(forwarded.readUInt16LE(forwarded.length - 2)).toBe(0)
    expect(Object.keys((await JSZip.loadAsync(forwarded)).files)).toEqual([])
    expect(await readFile(path)).toEqual(archive)
  })
})
