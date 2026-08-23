/**
 * Splits sections into overlapping windows for embedding.
 *
 * Chunking is what makes per-requirement matching work: a single vector for a
 * whole resume averages a candidate's decade of work into mush, whereas one
 * vector per ~200 words lets a specific bullet answer a specific requirement.
 */
import type { SectionKind } from '@shared/types.js'
import type { Section } from './sections.js'

const TARGET_WORDS = 200
const OVERLAP_WORDS = 50
/** Below this, a window is noise rather than signal (e.g. a trailing address). */
const MIN_WORDS = 12

export interface Chunk {
  section: SectionKind
  ordinal: number
  text: string
}

function windowsOf(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  if (words.length <= TARGET_WORDS) return [words.join(' ')]

  const out: string[] = []
  const stride = TARGET_WORDS - OVERLAP_WORDS
  for (let i = 0; i < words.length; i += stride) {
    const slice = words.slice(i, i + TARGET_WORDS)
    // Drop a short trailing remainder, because the overlap already covers that text.
    if (slice.length < MIN_WORDS && out.length > 0) break
    out.push(slice.join(' '))
    if (i + TARGET_WORDS >= words.length) break
  }
  return out
}

export function chunkSections(sections: Section[]): Chunk[] {
  const chunks: Chunk[] = []
  let ordinal = 0

  for (const section of sections) {
    for (const text of windowsOf(section.text)) {
      if (text.split(/\s+/).length < MIN_WORDS && chunks.length > 0) continue
      chunks.push({ section: section.kind, ordinal: ordinal++, text })
    }
  }

  return chunks
}
