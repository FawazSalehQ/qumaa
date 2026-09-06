/**
 * Optional watched folder. On start it performs a catch-up scan so files added
 * while the app was closed are picked up; dedupe by content hash makes that scan
 * cheap and idempotent.
 */
import chokidar, { type FSWatcher } from 'chokidar'
import { basename } from 'node:path'
import { indexReadiness } from '../embed/readiness.js'
import { maintenance } from '../maintenance.js'
import { isSupported } from './extract.js'
import { collectFiles, ingestValidatedFile } from './pipeline.js'
import { GenerationQueue } from './generation-queue.js'
import {
  canonicalizeWatchedRoot,
  validateWatchedFileSource,
  type ValidatedWatchRoot
} from './source-file.js'
import type { IngestOutcome } from '@shared/types.js'

type Listener = (outcome: IngestOutcome) => void

let watcher: FSWatcher | null = null
let listener: Listener = () => {}
/** Serialises ingestion so a bulk drop cannot start 200 concurrent extractions. */
const queue = new GenerationQueue()
/** Serialises start/change/stop requests, including concurrent settings calls. */
let transition: Promise<void> = Promise.resolve()
/**
 * Groups a whole watcher lifecycle change (stop/drain, database maintenance,
 * and optional restart). Without this outer lock a concurrent Settings change
 * can restart the watcher in the gap before restore/delete becomes exclusive.
 */
let lifecycle: Promise<void> = Promise.resolve()

export function onWatchIngest(fn: Listener): void {
  listener = fn
}

function enqueue(path: string, generation: number, watchedRoot: ValidatedWatchRoot): void {
  queue.enqueue(
    generation,
    (): Promise<IngestOutcome | null> =>
      maintenance.runOperation(async () => {
        // Revalidate each asynchronous event immediately before ingestion. The
        // returned canonical path and identity are verified again on open.
        let source
        try {
          source = await validateWatchedFileSource(watchedRoot, path)
        } catch {
          return null
        }
        try {
          return await ingestValidatedFile(source)
        } catch (err) {
          return {
            status: 'failed',
            fileName: basename(path),
            reason: err instanceof Error ? err.message : 'Ingest failed'
          }
        }
      }),
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

export function withWatcherLifecycle<T>(action: () => Promise<T>): Promise<T> {
  const run = lifecycle.then(action, action)
  lifecycle = run.then(
    () => undefined,
    () => undefined
  )
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
    const watchedRoot = await canonicalizeWatchedRoot(folder)
    const files = await collectFiles(watchedRoot.canonicalPath)
    if (!queue.isCurrent(generation)) return
    for (const file of files) enqueue(file, generation, watchedRoot)

    if (!queue.isCurrent(generation)) return
    const nextWatcher = chokidar.watch(watchedRoot.canonicalPath, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (p) => basename(p).startsWith('.'),
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
      depth: 8
    })
    watcher = nextWatcher

    nextWatcher.on('add', (path) => {
      if (queue.isCurrent(generation) && isSupported(path)) {
        enqueue(path, generation, watchedRoot)
      }
    })
  })
}

export function stopWatching(): Promise<void> {
  // This makes queued work stale synchronously. `closeAndDrain` then waits for
  // the one task that may already be inside extraction or its DB transaction.
  queue.nextGeneration()
  return serializeTransition(closeAndDrain)
}
