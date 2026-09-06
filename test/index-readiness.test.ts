import { describe, expect, it, vi } from 'vitest'
import { IndexReadiness } from '../src/main/embed/readiness.js'

function deferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('IndexReadiness', () => {
  it('holds callers until the complete initialization task finishes', async () => {
    const work = deferred()
    const barrier = new IndexReadiness()
    const initialize = vi.fn(async () => {
      await work.promise
    })

    const started = barrier.start(initialize)
    const waiting = barrier.waitUntilReady()
    await Promise.resolve()

    expect(initialize).toHaveBeenCalledOnce()
    expect(barrier.getStatus()).toEqual({ state: 'loading' })

    work.resolve()
    await expect(waiting).resolves.toBeUndefined()
    await expect(started).resolves.toBeUndefined()
    expect(barrier.getStatus()).toEqual({ state: 'ready' })
  })

  it('is single-flight when start is requested more than once', async () => {
    const barrier = new IndexReadiness()
    const initialize = vi.fn(async () => undefined)

    await Promise.all([barrier.start(initialize), barrier.start(initialize)])

    expect(initialize).toHaveBeenCalledOnce()
  })

  it('keeps operations closed and exposes the initialization error', async () => {
    const barrier = new IndexReadiness()
    const failure = new Error('bad index')

    await expect(barrier.start(async () => Promise.reject(failure))).rejects.toThrow(
      'bad index'
    )
    expect(barrier.getStatus()).toEqual({ state: 'error', message: 'bad index' })
    await expect(barrier.waitUntilReady()).rejects.toThrow('bad index')
  })

  it('rejects work if initialization was never started', async () => {
    const barrier = new IndexReadiness()
    await expect(barrier.waitUntilReady()).rejects.toThrow('has not started')
  })
})
