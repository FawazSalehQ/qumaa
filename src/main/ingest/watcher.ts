/**
 * Optional watched folder. On start it performs a catch-up scan so files added
 * while the app was closed are picked up; dedupe by content hash makes that scan
 * cheap and idempotent.
 */
import chokidar, { type FSWatcher } from 'chokidar'
import { basename } from 'node:path'
import { isSupported } from './extract.js'
import { collectFiles, ingestFile, fileExists } from './pipeline.js'
import type { IngestOutcome } from '@shared/types.js'

type Listener = (outcome: IngestOutcome) => void

let watcher: FSWatcher | null = null
let listener: Listener = () => {}
/** Serialises ingestion so a bulk drop cannot start 200 concurrent extractions. */
let queue: Promise<void> = Promise.resolve()

export function onWatchIngest(fn: Listener): void {
  listener = fn
}

function enqueue(path: string): void {
  queue = queue.then(async () => {
    // Editors and copy operations fire events before the file is complete;
    // a short settle plus an existence check avoids reading a partial file.
    if (!(await fileExists(path))) return
    try {
      const outcome = await ingestFile(path)
      // Duplicates are the normal case on a catch-up scan, so stay quiet about them.
      if (outcome.status !== 'duplicate') listener(outcome)
    } catch (err) {
      listener({
        status: 'failed',
        fileName: basename(path),
        reason: err instanceof Error ? err.message : 'Ingest failed'
      })
    }
  })
}

export async function startWatching(folder: string): Promise<void> {
  await stopWatching()

  // Catch-up scan first, so the folder's existing contents are indexed even
  // though chokidar's `ignoreInitial` suppresses add events for them.
  for (const file of await collectFiles(folder)) enqueue(file)

  watcher = chokidar.watch(folder, {
    ignoreInitial: true,
    ignored: (p) => basename(p).startsWith('.'),
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    depth: 8
  })

  watcher.on('add', (path) => {
    if (isSupported(path)) enqueue(path)
  })
}

export async function stopWatching(): Promise<void> {
  if (watcher) {
    await watcher.close()
    watcher = null
  }
}
