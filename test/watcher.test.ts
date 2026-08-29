import { describe, expect, it, vi } from 'vitest'
import type { IngestOutcome } from '../src/shared/types.js'

const mocks = vi.hoisted(() => ({
  collectFiles: vi.fn(async () => ['/watched/one.txt', '/watched/two.txt']),
  fileExists: vi.fn(async () => true),
  ingestFile: vi.fn(),
  isSupported: vi.fn(() => true),
  waitUntilReady: vi.fn(async () => undefined),
  watch: vi.fn()
}))

vi.mock('chokidar', () => ({ default: { watch: mocks.watch } }))
vi.mock('../src/main/embed/readiness.js', () => ({
  indexReadiness: { waitUntilReady: mocks.waitUntilReady }
}))
vi.mock('../src/main/ingest/extract.js', () => ({ isSupported: mocks.isSupported }))
vi.mock('../src/main/ingest/pipeline.js', () => ({
  collectFiles: mocks.collectFiles,
  fileExists: mocks.fileExists,
  ingestFile: mocks.ingestFile
}))

import {
  onWatchIngest,
  startWatching,
  stopWatching
} from '../src/main/ingest/watcher.js'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('watched-folder lifecycle', () => {
  it('cancels queued files, drains the active ingest, and suppresses its stale event', async () => {
    const active = deferred<IngestOutcome>()
    const close = vi.fn(async () => undefined)
    const watcher = {
      close,
      on: vi.fn(() => watcher)
    }
    const published = vi.fn()

    mocks.watch.mockReturnValue(watcher)
    mocks.ingestFile.mockImplementationOnce(() => active.promise)
    onWatchIngest(published)

    await startWatching('/watched')
    await vi.waitFor(() => expect(mocks.ingestFile).toHaveBeenCalledWith('/watched/one.txt'))

    let stopped = false
    const stopping = stopWatching().then(() => {
      stopped = true
    })
    await Promise.resolve()

    expect(close).toHaveBeenCalledOnce()
    expect(stopped).toBe(false)
    expect(mocks.ingestFile).not.toHaveBeenCalledWith('/watched/two.txt')

    active.resolve({ status: 'failed', fileName: 'one.txt', reason: 'settled' })
    await stopping

    expect(stopped).toBe(true)
    expect(mocks.ingestFile).toHaveBeenCalledTimes(1)
    expect(published).not.toHaveBeenCalled()
  })
})
