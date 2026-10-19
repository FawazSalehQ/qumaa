import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngestOutcome } from '../src/shared/types.js'

const mocks = vi.hoisted(() => ({
  canonicalizeWatchedRoot: vi.fn(async (folder: string) => ({
    canonicalPath: folder,
    identity: { device: 1n, inode: 1n }
  })),
  collectFiles: vi.fn(async () => ['/watched/one.pdf', '/watched/two.docx']),
  ingestValidatedFile: vi.fn(),
  isSupported: vi.fn(() => true),
  validateWatchedFileSource: vi.fn(async (_root: unknown, path: string) => ({
    canonicalPath: path,
    identity: { device: 1n, inode: 2n }
  })),
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
  ingestValidatedFile: mocks.ingestValidatedFile
}))
vi.mock('../src/main/ingest/source-file.js', () => ({
  canonicalizeWatchedRoot: mocks.canonicalizeWatchedRoot,
  validateWatchedFileSource: mocks.validateWatchedFileSource
}))

import {
  onWatchIngest,
  startWatching,
  stopWatching
} from '../src/main/ingest/watcher.js'
import { deferred } from './fixtures/async.js'


describe('watched-folder lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.collectFiles.mockResolvedValue(['/watched/one.pdf', '/watched/two.docx'])
    mocks.isSupported.mockReturnValue(true)
    mocks.canonicalizeWatchedRoot.mockImplementation(async (folder: string) => ({
      canonicalPath: folder,
      identity: { device: 1n, inode: 1n }
    }))
    mocks.validateWatchedFileSource.mockImplementation(async (_root: unknown, path: string) => ({
      canonicalPath: path,
      identity: { device: 1n, inode: 2n }
    }))
  })

  it('cancels queued files, drains the active ingest, and suppresses its stale event', async () => {
    const active = deferred<IngestOutcome>()
    const close = vi.fn(async () => undefined)
    const watcher = {
      close,
      on: vi.fn(() => watcher)
    }
    const published = vi.fn()

    mocks.watch.mockReturnValue(watcher)
    mocks.ingestValidatedFile.mockImplementationOnce(() => active.promise)
    onWatchIngest(published)

    await startWatching('/watched')
    await vi.waitFor(() =>
      expect(mocks.ingestValidatedFile).toHaveBeenCalledWith(
        expect.objectContaining({ canonicalPath: '/watched/one.pdf' })
      )
    )

    let stopped = false
    const stopping = stopWatching().then(() => {
      stopped = true
    })
    await Promise.resolve()

    expect(close).toHaveBeenCalledOnce()
    expect(stopped).toBe(false)
    expect(mocks.ingestValidatedFile).toHaveBeenCalledTimes(1)

    active.resolve({ status: 'failed', fileName: 'one.pdf', reason: 'settled' })
    await stopping

    expect(stopped).toBe(true)
    expect(mocks.ingestValidatedFile).toHaveBeenCalledTimes(1)
    expect(published).not.toHaveBeenCalled()
  })

  it('watches without following symlinks and rejects foreign or symlink add events', async () => {
    const handlers = new Map<string, (path: string) => void>()
    const watcher = {
      close: vi.fn(async () => undefined),
      on: vi.fn((event: string, handler: (path: string) => void) => {
        handlers.set(event, handler)
        return watcher
      })
    }
    mocks.collectFiles.mockResolvedValueOnce([])
    mocks.watch.mockReturnValue(watcher)
    mocks.ingestValidatedFile.mockResolvedValue({
      status: 'duplicate',
      fileName: 'ignored.pdf',
      existingId: 1
    })

    await startWatching('/watched')

    expect(mocks.watch).toHaveBeenCalledWith(
      '/watched',
      expect.objectContaining({ followSymlinks: false })
    )
    mocks.validateWatchedFileSource.mockRejectedValueOnce(new Error('outside'))
    handlers.get('add')?.('/outside/escape.pdf')
    await vi.waitFor(() =>
      expect(mocks.validateWatchedFileSource).toHaveBeenCalledWith(
        expect.objectContaining({ canonicalPath: '/watched' }),
        '/outside/escape.pdf'
      )
    )
    expect(mocks.ingestValidatedFile).not.toHaveBeenCalled()

    mocks.validateWatchedFileSource.mockRejectedValueOnce(new Error('symlink'))
    handlers.get('add')?.('/watched/link.pdf')
    await vi.waitFor(() =>
      expect(mocks.validateWatchedFileSource).toHaveBeenCalledWith(
        expect.objectContaining({ canonicalPath: '/watched' }),
        '/watched/link.pdf'
      )
    )
    expect(mocks.ingestValidatedFile).not.toHaveBeenCalled()

    await stopWatching()
  })
})
