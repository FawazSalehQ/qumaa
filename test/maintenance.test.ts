import { describe, expect, it } from 'vitest'
import { MaintenanceCoordinator } from '../src/main/maintenance.js'
import { deferred, settle } from './fixtures/async.js'

describe('MaintenanceCoordinator', () => {
  it('drains normal work before maintenance and blocks later work', async () => {
    const coordinator = new MaintenanceCoordinator()
    const operationDone = deferred()
    const maintenanceDone = deferred()
    const events: string[] = []

    const active = coordinator.runOperation(async () => {
      events.push('operation:start')
      await operationDone.promise
      events.push('operation:end')
    })
    await settle()

    const maintenance = coordinator.runMaintenance(async () => {
      events.push('maintenance:start')
      await maintenanceDone.promise
    })
    const late = coordinator.runOperation(() => {
      events.push('operation:late')
    })

    await settle()
    expect(events).toEqual(['operation:start'])
    operationDone.resolve()
    await settle()
    expect(events).toEqual(['operation:start', 'operation:end', 'maintenance:start'])

    maintenanceDone.resolve()
    await Promise.all([active, maintenance, late])
    expect(events.at(-1)).toBe('operation:late')
  })

  it('releases the maintenance lock after a failure', async () => {
    const coordinator = new MaintenanceCoordinator()
    await expect(
      coordinator.runMaintenance(() => {
        throw new Error('backup failed')
      })
    ).rejects.toThrow('backup failed')
    await expect(coordinator.runOperation(() => 'usable')).resolves.toBe('usable')
  })

  it('rejects stale work as soon as a library replacement is requested', async () => {
    const coordinator = new MaintenanceCoordinator()
    const activeDone = deferred()
    const replacementDone = deferred()

    const active = coordinator.runOperation(() => activeDone.promise)
    await settle()
    const replacement = coordinator.runLibraryChange(() => replacementDone.promise)

    await expect(coordinator.runOperation(() => 'stale')).rejects.toThrow(
      'library is being replaced'
    )
    activeDone.resolve()
    await settle()
    replacementDone.resolve()
    await Promise.all([active, replacement])
    await expect(coordinator.runOperation(() => 'fresh')).resolves.toBe('fresh')
  })
})
