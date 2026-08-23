#!/usr/bin/env node
/**
 * Generates THIRD-PARTY-NOTICES.md from the licences of everything the
 * installer actually redistributes.
 *
 * This is not paperwork for its own sake. The two bundled fonts are OFL-1.1,
 * which requires the licence text to travel with the font files, and sharp and
 * transformers.js are Apache-2.0, which requires the licence and any notices to
 * be preserved. Vite compiles the fonts into the renderer bundle, so nothing
 * would otherwise carry their terms into the shipped app.
 *
 * The result is written to the repo root and shipped inside the app via
 * extraResources, so both the source and the installed product carry it.
 */
import { readFile, writeFile, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Everything that ends up inside the installer. Build-only tooling is excluded. */
const BUNDLED = [
  '@huggingface/transformers',
  'onnxruntime-node',
  'better-sqlite3',
  'sharp',
  'mammoth',
  'unpdf',
  'chokidar',
  'react',
  'react-dom',
  'electron',
  '@fontsource-variable/inter',
  '@fontsource-variable/cairo'
]

const LICENSE_FILENAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'license']

async function licenseText(pkgDir) {
  for (const name of LICENSE_FILENAMES) {
    const p = join(pkgDir, name)
    try {
      await access(p)
      return (await readFile(p, 'utf8')).trim()
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

const sections = []

for (const name of BUNDLED) {
  const pkgDir = join(root, 'node_modules', name)
  const meta = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'))
  const text = await licenseText(pkgDir)
  sections.push(
    `## ${name} ${meta.version}\n\n` +
      `License: ${meta.license ?? 'see below'}` +
      (meta.homepage ? `  \nHomepage: ${meta.homepage}` : '') +
      '\n\n' +
      (text
        ? '```\n' + text + '\n```'
        : `_No licence file shipped in the package; see the ${meta.license} terms._`)
  )
}

const header = `# Third-party notices

قُمع bundles the components below. Each remains under its own licence, quoted in
full where the package ships one.

The embedding model, **BAAI/bge-small-en-v1.5**, is redistributed under the MIT
licence from https://huggingface.co/BAAI/bge-small-en-v1.5 and is vendored into
\`resources/models/\` at build time.

---

`

await writeFile(join(root, 'THIRD-PARTY-NOTICES.md'), header + sections.join('\n\n---\n\n') + '\n', 'utf8')
console.log(`THIRD-PARTY-NOTICES.md  (${sections.length} components)`)
