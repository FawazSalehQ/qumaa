/** One quoting rule for every CSV Qumaa writes. */
export type CsvValue = string | number | null | { numeric: string }

/**
 * Quoting handles delimiters; the apostrophe keeps spreadsheet formulas inert.
 * Pass engine numbers as `{ numeric }` so signed values stay machine-readable.
 */
export function csvCell(value: CsvValue): string {
  if (value !== null && typeof value === 'object') return `"${value.numeric.replace(/"/g, '""')}"`
  let text = value === null ? '' : String(value)
  if (/^[\s]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
