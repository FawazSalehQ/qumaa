import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMBEDDING_DIM, type ToWorker } from '../src/main/embed/protocol.js'

const { fork } = vi.hoisted(() => ({ fork: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  utilityProcess: { fork }
}))

class FakeWorker extends EventEmitter {
  postMessage = vi.fn<(message: ToWorker) => void>()
}

let worker: FakeWorker
let embedder: typeof import('../src/main/embed/client.js').embedder

beforeEach(async () => {
  vi.resetModules()
  fork.mockReset().mockImplementation(() => {
    worker = new FakeWorker()
    return worker
  })
  const client = await import('../src/main/embed/client.js')
  client.setEntryDir('/test/out/main')
  embedder = client.embedder
})

describe('embedding worker lifecycle', () => {
  it('rejects startup and waiting embeddings when the worker exits before ready', async () => {
    const startup = embedder.start()
    expect(embedder.start()).toBe(startup)
    const startupRejected = expect(startup).rejects.toThrow('Embedding process exited (code 1)')
    const embeddingRejected = expect(embedder.embedQueries(['nurse'])).rejects.toThrow(
      'Embedding process exited (code 1)'
    )

    worker.emit('exit', 1)

    await Promise.all([startupRejected, embeddingRejected])
    expect(embedder.getStatus()).toEqual({
      state: 'error', message: 'Embedding process exited (code 1)'
    })
    expect(worker.postMessage).not.toHaveBeenCalled()

    const retry = embedder.start()
    expect(fork).toHaveBeenCalledTimes(2)
    worker.emit('message', { type: 'ready' })
    await retry
    expect(embedder.getStatus()).toEqual({ state: 'ready' })
  }, 1_000)

  it('resolves startup and embeddings after the worker is ready', async () => {
    const result = embedder.embedPassages(['nursing experience'])
    expect(worker.postMessage).not.toHaveBeenCalled()
    worker.emit('message', { type: 'ready' })

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce())
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'embed', id: 1, texts: ['passage: nursing experience']
    })
    const vector = new Float32Array(EMBEDDING_DIM).fill(0.5)
    worker.emit('message', { type: 'result', id: 1, vectors: vector })

    await expect(result).resolves.toEqual([vector])
    expect(embedder.getStatus()).toEqual({ state: 'ready' })
  })

  it('rejects a pending embedding when a ready worker exits', async () => {
    const startup = embedder.start()
    worker.emit('message', { type: 'ready' })
    await startup

    const result = embedder.embedQueries(['nurse'])
    const rejected = expect(result).rejects.toThrow('Embedding process exited (code 2)')
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce())
    worker.emit('exit', 2)

    await rejected
    // An exit after ready must not change the already completed startup result.
    await expect(startup).resolves.toBeUndefined()
    expect(embedder.getStatus()).toEqual({
      state: 'error', message: 'Embedding process exited (code 2)'
    })
  })
})
