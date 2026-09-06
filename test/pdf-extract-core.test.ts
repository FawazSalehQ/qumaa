import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { extractPdfTextBounded } from '../src/main/ingest/pdf-extract-core.js'

function pdfWithFlateContent(content: string): Buffer {
  const compressed = deflateSync(Buffer.from(content))
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
      compressed,
      Buffer.from('\nendstream')
    ]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  ]

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')]
  const offsets = [0]
  let length = parts[0].length
  objects.forEach((object, index) => {
    offsets.push(length)
    const record = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n')
    ])
    parts.push(record)
    length += record.length
  })

  const xrefOffset = length
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
    `startxref\n${xrefOffset}\n%%EOF\n`
  ].join('')
  parts.push(Buffer.from(xref))
  return Buffer.concat(parts)
}

describe('bounded PDF text extraction', () => {
  it('rejects a highly compressed content stream while text is being produced', async () => {
    // PDF.js itself caps a single literal token, but the bounded extractor must
    // still reject the resulting text before returning it to its parent.
    const expandedText = 'A'.repeat(20_000)
    const pdf = pdfWithFlateContent(`BT /F1 12 Tf 72 720 Td (${expandedText}) Tj ET`)

    expect(pdf.length).toBeLessThan(2_000)
    await expect(extractPdfTextBounded(pdf, 50)).rejects.toThrow(
      '50 character safety limit'
    )
  })

  it('preserves text extraction for an ordinary PDF fixture', async () => {
    const fixture = fileURLToPath(new URL('fixtures/files/maria-chen.pdf', import.meta.url))
    const pdf = await readFile(fixture)
    const text = await extractPdfTextBounded(pdf, 500_000)

    expect(text).toContain('Maria Chen')
  })
})
