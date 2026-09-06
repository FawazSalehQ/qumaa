import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { crc32, deflateRawSync } from 'node:zlib'
import {
  extractFile,
  isSupported,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_SOURCE_FILE_BYTES,
  SUPPORTED_EXTENSIONS
} from '../src/main/ingest/extract.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

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
  })
})
