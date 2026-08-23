/**
 * Dev utility: fills the real library with the test corpus so the UI can be
 * worked on with realistic data. Run with `npm run seed`.
 *
 * Unlike smoke.ts this writes to the actual userData directory. It is additive,
 * because content-hash dedupe means re-running it is a no-op.
 */
import { app } from 'electron'
import { basename, resolve } from 'node:path'

// Launched as a bare script, app.getName() falls back to "Electron" because
// there is no package.json beside out/main, which would silently seed a
// different userData directory than the app itself reads. Pin it.
app.setName('cv-filter')

async function run(): Promise<void> {
  const { setEntryDir } = await import('./embed/client.js')
  setEntryDir(__dirname)
  const { ingestFile, ingestText, collectFiles } = await import('./ingest/pipeline.js')
  const { stats } = await import('./db/index.js')
  const { RESUMES } = await import('../../test/fixtures/corpus.js')

  for (const file of await collectFiles(resolve(__dirname, '..', '..', 'test/fixtures/files'))) {
    const o = await ingestFile(file)
    console.log(`  ${o.status.padEnd(10)} ${basename(file)}`)
  }

  // The two file fixtures are Maria Chen and Aisha Rahman, who also appear in
  // the text corpus. Skip those so the seeded library holds ten distinct people
  // rather than two near-duplicate pairs.
  const fromFiles = new Set(['be-1', 'rn-1'])

  for (const fixture of RESUMES) {
    if (fromFiles.has(fixture.id)) continue
    const name = fixture.text.split('\n')[0].trim()
    const o = await ingestText({
      text: fixture.text,
      fileName: `${name.toLowerCase().replace(/\s+/g, '-')}.txt`,
      filePath: '',
      fileType: 'pasted'
    })
    console.log(`  ${o.status.padEnd(10)} ${name}`)
  }

  const s = stats()
  console.log(`\nLibrary now holds ${s.resumeCount} resumes / ${s.chunkCount} chunks.`)
}

app.whenReady().then(async () => {
  try {
    await run()
    app.exit(0)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
})
