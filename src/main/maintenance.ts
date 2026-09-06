import { SharedExclusiveGate } from './shared-exclusive-gate.js'

/**
 * One process-wide coordination point for every operation that observes or
 * mutates the library. Normal work may overlap. Maintenance is exclusive and
 * therefore sees a drained, stable database and prevents new work until it has
 * either committed or rolled back.
 */
export class MaintenanceCoordinator {
  private readonly gate = new SharedExclusiveGate()
  /**
   * Set synchronously when a library replacement is requested. This closes the
   * admission gap before the exclusive lease is granted: renderer work created
   * from the old library must not queue and later run against the new one.
   */
  private libraryChangesPending = 0

  runOperation<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.libraryChangesPending > 0) {
      return Promise.reject(
        new Error('The resume library is being replaced. Refresh it and try again.')
      )
    }
    return this.gate.runShared(() => Promise.resolve().then(work))
  }

  runMaintenance<T>(work: () => T | Promise<T>): Promise<T> {
    return this.gate.runExclusive(async () => work())
  }

  /**
   * Exclusive maintenance that changes record identity (restore or full wipe).
   * New operations fail instead of waiting and accidentally applying stale ids
   * after the replacement completes.
   */
  async runLibraryChange<T>(work: () => T | Promise<T>): Promise<T> {
    this.libraryChangesPending++
    try {
      return await this.runMaintenance(work)
    } finally {
      this.libraryChangesPending--
    }
  }
}

export const maintenance = new MaintenanceCoordinator()
