/**
 * Optional watched folder. On start it performs a catch-up scan so files added
 * while the app was closed are picked up; dedupe by content hash makes that scan
 * cheap and idempotent.
 */
import chokidar, { type FSWatcher } from 'chokidar'
import { basename } from 'node:path'
import { indexReadiness } from '../embed/readiness.js'
import { isSupported } from './extract.js'
import { collectFiles, ingestFile, fileExists } from './pipeline.js'
import { GenerationQueue } from './generation-queue.js'
import type { IngestOutcome } from '@shared/types.js'

type Listener = (outcome: IngestOutcome) => void

let watcher: FSWatcher | null = null
let listener: Listener = () => {}
/** Serialises ingestion so a bulk drop cannot start 200 concurrent extractions. */
const queue = new GenerationQueue()
/** Serialises start/change/stop requests, including concurrent settings calls. */
let transition: Promise<void> = Promise.resolve()

export function onWatchIngest(fn: Listener): void {
  listener = fn
}

function enqueue(path: string, generation: number): void {
  queue.enqueue(
    generation,
    async (): Promise<IngestOutcome | null> => {
      // Editors and copy operations fire events before the file is complete;
      // a short settle plus an existence check avoids reading a partial file.
      if (!(await fileExists(path))) return null
      try {
        return await ingestFile(path)
      } catch (err) {
        return {
          status: 'failed',
          fileName: basename(path),
          reason: err instanceof Error ? err.message : 'Ingest failed'
        }
      }
    },
    (outcome) => {
      // Duplicates are the normal case on a catch-up scan, so stay quiet about them.
      if (outcome && outcome.status !== 'duplicate') listener(outcome)
    }
  )
}

function serializeTransition(action: () => Promise<void>): Promise<void> {
  const run = transition.then(action, action)
  transition = run.catch(() => undefined)
  return run
}

async function closeAndDrain(): Promise<void> {
  const closing = watcher
  watcher = null
  if (closing) await closing.close()
  // Any import that crossed the cancellation boundary is allowed to finish.
  // Callers such as the full-library wipe wait here before deleting rows, so
  // that old work cannot commit afterwards and repopulate the database.
  await queue.drain()
}

export function startWatching(folder: string): Promise<void> {
  // Invalidate the old folder immediately, even if another transition is still
  // collecting files. The serialized transition then closes and drains it.
  const generation = queue.nextGeneration()
  return serializeTransition(async () => {
    await closeAndDrain()
    await indexReadiness.waitUntilReady()
    if (!queue.isCurrent(generation)) return

    // Catch-up scan first, so the folder's existing contents are indexed even
    // though chokidar's `ignoreInitial` suppresses add events for them.
    const files = await collectFiles(folder)
    if (!queue.isCurrent(generation)) return
    for (const file of files) enqueue(file, generation)

    if (!queue.isCurrent(generation)) return
    const nextWatcher = chokidar.watch(folder, {
      ignoreInitial: true,
      ignored: (p) => basename(p).startsWith('.'),
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
      depth: 8
    })
    watcher = nextWatcher

    nextWatcher.on('add', (path) => {
      if (queue.isCurrent(generation) && isSupported(path)) enqueue(path, generation)
    })
  })
}

export function stopWatching(): Promise<void> {
  // This makes queued work stale synchronously. `closeAndDrain` then waits for
  // the one task that may already be inside extraction or its DB transaction.
  queue.nextGeneration()
  return serializeTransition(closeAndDrain)
}
