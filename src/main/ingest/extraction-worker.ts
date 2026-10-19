/** Disposable, memory-capped PDF/DOCX parsing utility process. */
import { extractPdfTextBounded } from './pdf-extract-core.js'
import { MAX_EXTRACTED_TEXT_CHARS, MAX_SOURCE_FILE_BYTES, type FromExtractionWorker, type ToExtractionWorker } from './extraction-protocol.js'

function send(message: FromExtractionWorker): void {
  process.parentPort.postMessage(message)
}

function safeRequest(value: unknown): value is ToExtractionWorker {
  if (typeof value !== 'object' || value === null) return false
  const request = value as Partial<ToExtractionWorker>
  return (
    (request.type === 'extract-pdf' || request.type === 'extract-docx') &&
    request.data instanceof Uint8Array &&
    request.data.byteLength <= MAX_SOURCE_FILE_BYTES &&
    Number.isInteger(request.maxCharacters) &&
    request.maxCharacters === MAX_EXTRACTED_TEXT_CHARS
  )
}

async function extract(request: ToExtractionWorker): Promise<string> {
  if (request.type === 'extract-pdf') {
    return extractPdfTextBounded(request.data, request.maxCharacters)
  }
  const mammoth = (await import('mammoth')).default
  const buffer = Buffer.from(request.data.buffer, request.data.byteOffset, request.data.byteLength)
  const { value } = await mammoth.extractRawText({ buffer })
  return value
}

process.parentPort.once('message', (event) => {
  const request = event.data as unknown
  if (!safeRequest(request)) {
    send({ type: 'error', message: 'Document extraction request failed validation.' })
    return
  }

  extract(request)
    .then((text) => {
      if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
        throw new Error("Resume text exceeds Qumaa's 500,000 character safety limit.")
      }
      send({ type: 'result', text })
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error &&
        (error.message.startsWith('PDF ') || error.message.startsWith('Resume text '))
          ? error.message
          : 'Could not safely extract document text.'
      send({ type: 'error', message })
    })
})
