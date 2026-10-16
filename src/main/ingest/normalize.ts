/**
 * Cleans raw extracted text. PDF extraction in particular produces ligatures,
 * hyphen-wrapped words, and bullet glyph noise that would otherwise leak into
 * both the embeddings and the displayed evidence snippets.
 */

const LIGATURES: Array<[RegExp, string]> = [
  [/ﬀ/g, 'ff'],
  [/ﬁ/g, 'fi'],
  [/ﬂ/g, 'fl'],
  [/ﬃ/g, 'ffi'],
  [/ﬄ/g, 'ffl'],
  [/ /g, ' '] // non-breaking space
]

/** Bullet glyphs and other decorative leaders that carry no meaning. */
// Never scan across another multiline start: an all-newline prefix otherwise
// retries the entire remaining suffix at each line. Keep the existing trailing
// whitespace behavior, including standalone decorative bullet lines.
const BULLETS = /^[^\S\r\n\u2028\u2029]*[•▪◦‣·∙●○*–—\-]{1,2}\s+/gm

export function normalizeText(input: string): string {
  let t = input.replace(/\r\n?/g, '\n')

  for (const [re, sub] of LIGATURES) t = t.replace(re, sub)

  // Normalise the various dash and quote characters PDFs emit.
  t = t
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑]/g, '-')

  // Rejoin words split across a line break by hyphenation: "engi-\nneering".
  t = t.replace(/([A-Za-z])-\n([a-z])/g, '$1$2')

  // Strip standalone page markers, e.g. "Page 2 of 5" or a lone "3", consuming
  // the trailing newline so no blank line is left behind.
  t = t.replace(/^[ \t]*(?:page\s+)?\d+(?:\s+of\s+\d+)?[ \t]*$\n?/gim, '')

  t = t.replace(BULLETS, '')

  // Collapse runs of spaces/tabs, but keep newlines: line structure is what the
  // section splitter and the name heuristic both rely on.
  t = t.replace(/[ \t]{2,}/g, ' ')
  t = t.replace(/ +\n/g, '\n')
  t = t.replace(/\n{3,}/g, '\n\n')

  return t.trim()
}

/** Single-line form used for hashing and lexical search. */
export function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
