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
