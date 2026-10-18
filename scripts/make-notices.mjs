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
  '@anthropic-ai/sdk',
  'zod',
  'jose',
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
  '@fontsource-variable/ibm-plex-sans',
  '@fontsource/ibm-plex-sans-arabic',
  '@fontsource/ibm-plex-mono'
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

## Embedding model

The bundled weights are **multilingual-e5-small**, vendored into
\`resources/models/\` by \`npm run fetch-model\`.

They are downloaded from **https://huggingface.co/Xenova/multilingual-e5-small**,
an ONNX conversion of the original model. That conversion repository declares no
licence of its own and is tagged as derived from
**https://huggingface.co/intfloat/multilingual-e5-small**, which is **MIT**. The
MIT terms of the upstream model therefore govern the weights redistributed here.

---

`

await writeFile(join(root, 'THIRD-PARTY-NOTICES.md'), header + sections.join('\n\n---\n\n') + '\n', 'utf8')
console.log(`THIRD-PARTY-NOTICES.md  (${sections.length} components)`)
