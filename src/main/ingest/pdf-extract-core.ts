import { getDocumentProxy } from 'unpdf'
import {
  MAX_PDF_IMAGE_PIXELS,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_ITEMS
} from './extraction-protocol.js'

interface PdfTextItem {
  str: string
  hasEOL?: boolean
}

function isTextItem(value: unknown): value is PdfTextItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'str' in value &&
    typeof (value as { str?: unknown }).str === 'string'
  )
}

function normalizeMergedText(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * Extracts PDF text a page and stream chunk at a time. The caller runs this in
 * a disposable utility process; these counters additionally stop normal large
 * documents before an attacker-sized text result can be accumulated or sent.
 */
export async function extractPdfTextBounded(
  data: Uint8Array,
  maxCharacters: number
): Promise<string> {
  // PDF.js deliberately rejects Node's Buffer subclass. Re-wrap without
  // copying so callers and structured-clone variants are handled uniformly.
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const pdf = await getDocumentProxy(bytes, {
    maxImageSize: MAX_PDF_IMAGE_PIXELS,
    stopAtErrors: true
  })

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF contains more than Qumaa's ${MAX_PDF_PAGES}-page safety limit.`)
    }

    const output: string[] = []
    let characters = 0
    let textItems = 0

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (pageNumber > 1) {
        output.push('\n')
        characters++
      }

      const page = await pdf.getPage(pageNumber)
      const reader = page.streamTextContent().getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const items = (value as { items?: unknown[] } | undefined)?.items
          if (!Array.isArray(items)) throw new Error('PDF returned malformed text content.')

          for (const item of items) {
            if (!isTextItem(item)) continue
            textItems++
            if (textItems > MAX_PDF_TEXT_ITEMS) {
              throw new Error("PDF exceeds Qumaa's text-item safety limit.")
            }
            const piece = item.str + (item.hasEOL ? '\n' : '')
            characters += piece.length
            if (characters > maxCharacters) {
              throw new Error(
                `Resume text exceeds Qumaa's ${maxCharacters.toLocaleString('en-US')} character safety limit.`
              )
            }
            output.push(piece)
          }
        }
      } finally {
        page.cleanup()
      }
    }

    return normalizeMergedText(output.join(''))
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined)
  }
}
