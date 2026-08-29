import { describe, expect, it } from 'vitest'
import { SharedExclusiveGate } from '../src/main/shared-exclusive-gate.js'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe('SharedExclusiveGate', () => {
  it('waits for active shared work and blocks later readers behind a writer', async () => {
    const gate = new SharedExclusiveGate()
    const firstDone = deferred()
    const secondDone = deferred()
    const exclusiveDone = deferred()
    const events: string[] = []

    const first = gate.runShared(async () => {
      events.push('shared-1:start')
      await firstDone.promise
      events.push('shared-1:end')
    })
    const second = gate.runShared(async () => {
      events.push('shared-2:start')
      await secondDone.promise
      events.push('shared-2:end')
    })
    await settle()

    const exclusive = gate.runExclusive(async () => {
      events.push('exclusive:start')
      await exclusiveDone.promise
      events.push('exclusive:end')
    })
    const lateShared = gate.runShared(async () => {
      events.push('shared-late')
    })
    await settle()

    expect(events).toEqual(['shared-1:start', 'shared-2:start'])

    firstDone.resolve()
    secondDone.resolve()
    await settle()
    expect(events).toEqual([
      'shared-1:start',
      'shared-2:start',
      'shared-1:end',
      'shared-2:end',
      'exclusive:start'
    ])

    exclusiveDone.resolve()
    await Promise.all([first, second, exclusive, lateShared])
    expect(events.slice(-2)).toEqual(['exclusive:end', 'shared-late'])
  })

  it('releases exclusive access when work rejects', async () => {
    const gate = new SharedExclusiveGate()

    await expect(
      gate.runExclusive(async () => {
        throw new Error('wipe failed')
      })
    ).rejects.toThrow('wipe failed')

    await expect(gate.runShared(async () => 'imported')).resolves.toBe('imported')
  })

  it('serializes exclusive operations', async () => {
    const gate = new SharedExclusiveGate()
    const firstDone = deferred()
    const events: string[] = []

    const first = gate.runExclusive(async () => {
      events.push('first:start')
      await firstDone.promise
      events.push('first:end')
    })
    const second = gate.runExclusive(async () => {
      events.push('second')
    })
    await settle()
    expect(events).toEqual(['first:start'])

    firstDone.resolve()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second'])
  })
})
