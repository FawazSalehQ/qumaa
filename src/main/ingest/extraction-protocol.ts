/** Largest source file main will read and the worker will accept. */
export const MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024
/** Largest extracted text main will store and the worker will return. */
export const MAX_EXTRACTED_TEXT_CHARS = 500_000
export const MAX_PDF_PAGES = 200
export const MAX_PDF_IMAGE_PIXELS = 16_777_216
export const MAX_PDF_TEXT_ITEMS = 250_000
export const EXTRACTION_TIMEOUT_MS = 20_000
export const EXTRACTION_WORKER_HEAP_MB = 192

export type ToExtractionWorker = {
  type: 'extract-pdf' | 'extract-docx'
  data: Uint8Array
  maxCharacters: number
}

export type FromExtractionWorker =
  | { type: 'result'; text: string }
  | { type: 'error'; message: string }
