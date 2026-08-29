import { describe, expect, it, vi } from 'vitest'
import { GenerationQueue } from '../src/main/ingest/generation-queue.js'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('GenerationQueue', () => {
  it('skips work that was queued by an invalidated generation', async () => {
    const queue = new GenerationQueue()
    const token = queue.nextGeneration()
    const blocker = deferred<void>()
    const staleWork = vi.fn(async () => 'stale')
    const publish = vi.fn()

    queue.enqueue(token, () => blocker.promise, () => undefined)
    queue.enqueue(token, staleWork, publish)
    await Promise.resolve()

    queue.nextGeneration()
    blocker.resolve()
    await queue.drain()

    expect(staleWork).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('drains in-flight work but suppresses its stale result', async () => {
    const queue = new GenerationQueue()
    const token = queue.nextGeneration()
    const work = deferred<string>()
    const publish = vi.fn()
    let drained = false

    queue.enqueue(token, () => work.promise, publish)
    await Promise.resolve()
    queue.nextGeneration()
    const draining = queue.drain().then(() => {
      drained = true
    })
    await Promise.resolve()

    expect(drained).toBe(false)
    work.resolve('finished')
    await draining
    expect(publish).not.toHaveBeenCalled()
  })

  it('serializes new-generation work behind an old in-flight task', async () => {
    const queue = new GenerationQueue()
    const firstToken = queue.nextGeneration()
    const blocker = deferred<string>()
    const order: string[] = []

    queue.enqueue(firstToken, () => blocker.promise, () => order.push('stale'))
    await Promise.resolve()

    const nextToken = queue.nextGeneration()
    queue.enqueue(
      nextToken,
      async () => {
        order.push('new-work')
        return 'new-result'
      },
      () => order.push('new-result')
    )
    await Promise.resolve()
    expect(order).toEqual([])

    blocker.resolve('old-result')
    await queue.drain()
    expect(order).toEqual(['new-work', 'new-result'])
  })
})
