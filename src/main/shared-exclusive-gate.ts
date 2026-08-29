/**
 * Fair async reader/writer gate.
 *
 * Shared operations may overlap. An exclusive operation waits for existing
 * shared work, then blocks all later work until it completes. Once an exclusive
 * waiter is queued, newer shared work stays behind it so destructive work cannot
 * starve under a stream of imports.
 */
type Mode = 'shared' | 'exclusive'
type Release = () => void

interface Waiter {
  mode: Mode
  grant: (release: Release) => void
}

export class SharedExclusiveGate {
  private activeShared = 0
  private activeExclusive = false
  private waiters: Waiter[] = []

  runShared<T>(work: () => Promise<T>): Promise<T> {
    return this.run('shared', work)
  }

  runExclusive<T>(work: () => Promise<T>): Promise<T> {
    return this.run('exclusive', work)
  }

  private async run<T>(mode: Mode, work: () => Promise<T>): Promise<T> {
    const release = await this.acquire(mode)
    try {
      return await work()
    } finally {
      release()
    }
  }

  private acquire(mode: Mode): Promise<Release> {
    return new Promise((grant) => {
      this.waiters.push({ mode, grant })
      this.drain()
    })
  }

  private drain(): void {
    if (this.activeExclusive) return

    if (this.activeShared > 0) {
      // Only readers already ahead of the first writer may join the active set.
      while (this.waiters[0]?.mode === 'shared') this.grantShared()
      return
    }

    if (this.waiters[0]?.mode === 'exclusive') {
      const waiter = this.waiters.shift()!
      this.activeExclusive = true
      waiter.grant(this.once(() => {
        this.activeExclusive = false
        this.drain()
      }))
      return
    }

    // No work is active and readers are at the front: admit the whole adjacent
    // reader group, but stop at a queued writer to preserve request ordering.
    while (this.waiters[0]?.mode === 'shared') this.grantShared()
  }

  private grantShared(): void {
    const waiter = this.waiters.shift()!
    this.activeShared++
    waiter.grant(this.once(() => {
      this.activeShared--
      if (this.activeShared === 0) this.drain()
    }))
  }

  private once(release: () => void): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      release()
    }
  }
}
