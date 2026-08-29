/** A serial work queue whose pending results can be invalidated as a group. */
export class GenerationQueue {
  private generation = 0
  private tail: Promise<void> = Promise.resolve()

  /** Invalidates every task from the prior generation and returns a new token. */
  nextGeneration(): number {
    this.generation++
    return this.generation
  }

  isCurrent(token: number): boolean {
    return token === this.generation
  }

  /**
   * Work that already started is allowed to finish, but its result is discarded
   * after invalidation. Work that has not started is skipped entirely.
   */
  enqueue<T>(token: number, work: () => Promise<T>, publish: (result: T) => void): void {
    const run = this.tail.then(async () => {
      if (!this.isCurrent(token)) return
      const result = await work()
      if (this.isCurrent(token)) publish(result)
    })
    // A rejected item must not poison every item queued behind it.
    this.tail = run.catch(() => undefined)
  }

  /** Resolves after the currently queued or running work has settled. */
  drain(): Promise<void> {
    return this.tail
  }
}
