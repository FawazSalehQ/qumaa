import { afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Creates scratch directories under the OS temp folder and removes them after each test. */
export function temporaryDirectories(prefix: string): { create: () => Promise<string>; createSync: () => string } {
  const created: string[] = []
  afterEach(async () => {
    await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })
  return {
    create: async () => {
      const directory = await mkdtemp(join(tmpdir(), prefix))
      created.push(directory)
      return directory
    },
    createSync: () => {
      const directory = mkdtempSync(join(tmpdir(), prefix))
      created.push(directory)
      return directory
    }
  }
}
