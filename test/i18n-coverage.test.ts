import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { arabicMessages } from '../src/shared/i18n.js'

/**
 * Every literal interface string must have an Arabic entry. translate() falls back to
 * English silently, so without this check a missing entry only shows up as English text
 * in the Arabic interface. Only complete literal arguments are checked: t('…') and
 * translate(language, '…') followed by `)` or `,`. Keys without Latin letters (the
 * Arabic product name) are already Arabic.
 */
const ROOTS = ['src/renderer/src', 'src/main']
const LITERAL = String.raw`(['"])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]`
const CALLS = [new RegExp(String.raw`\bt\(\s*` + LITERAL, 'g'), new RegExp(String.raw`\btranslate\(\s*[\w.]+\s*,\s*` + LITERAL, 'g')]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
  })
}

function literalKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  for (const file of ROOTS.flatMap((root) => sourceFiles(root))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      for (const pattern of CALLS) {
        for (const match of line.matchAll(pattern)) {
          const key = match[2].replace(/\\(['"\\])/g, '$1')
          if (/[A-Za-z]/.test(key) && !keys.has(key)) keys.set(key, `${relative(process.cwd(), file)}:${index + 1}`)
        }
      }
    })
  }
  return keys
}

describe('Arabic coverage', () => {
  it('finds the interface strings it is meant to check', () => {
    expect(literalKeys().size).toBeGreaterThan(500)
  })

  it('has an Arabic entry for every literal interface string', () => {
    const missing = [...literalKeys()].filter(([key]) => !(key in arabicMessages)).map(([key, where]) => `${where}  ${key}`)
    expect(missing).toEqual([])
  })
})
