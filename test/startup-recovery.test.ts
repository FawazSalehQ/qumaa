import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { showStartupRecovery } from '../src/main/startup-recovery.js'

const native = vi.hoisted(() => ({
  dataFolder: '', locale: 'en-US',
  showMessageBox: vi.fn(), showItemInFolder: vi.fn(), quit: vi.fn()
}))
vi.mock('electron', () => ({
  app: {
    getLocale: () => native.locale,
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error('Unexpected recovery path')
      return native.dataFolder
    },
    quit: native.quit
  },
  dialog: { showMessageBox: native.showMessageBox },
  shell: { showItemInFolder: native.showItemInFolder }
}))
// Any accidental database dependency would make this recovery path unavailable
// for exactly the corrupt-library scenario it is meant to explain.
vi.mock('../src/main/db/index.js', () => { throw new Error('Recovery must not open SQLite') })
const preservedBytes = Buffer.from('fictional damaged library; preserve this for recovery')

beforeEach(async () => {
  vi.clearAllMocks()
  native.locale = 'en-US'
  native.dataFolder = await mkdtemp(join(tmpdir(), 'qumaa-recovery-'))
  native.showMessageBox.mockResolvedValue({ response: 0 })
  await writeFile(join(native.dataFolder, 'cv_filter.db'), preservedBytes)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(native.dataFolder, { recursive: true, force: true })
})

describe('startup failure recovery', () => {
  it.each(['en-US', 'ar-SA'])('explains recovery in OS locale %s without opening or replacing the library', async (locale) => {
    native.locale = locale
    await showStartupRecovery()
    expect(native.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error', cancelId: 1,
      message: locale === 'ar-SA' ? 'تعذّر بدء تشغيل قُمع.' : 'Qumaa could not start.',
      detail: expect.stringContaining(native.dataFolder)
    }))
    expect(native.showItemInFolder).toHaveBeenCalledWith(native.dataFolder)
    expect(native.quit).toHaveBeenCalledOnce()
    expect(await readFile(join(native.dataFolder, 'cv_filter.db'))).toEqual(preservedBytes)
  })

  it('lets the user quit without opening the data folder', async () => {
    native.showMessageBox.mockResolvedValue({ response: 1 })
    await showStartupRecovery()
    expect(native.showItemInFolder).not.toHaveBeenCalled()
    expect(native.quit).toHaveBeenCalledOnce()
    expect(await readFile(join(native.dataFolder, 'cv_filter.db'))).toEqual(preservedBytes)
  })

  it('does not leave an invisible process running when the native dialog fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    native.showMessageBox.mockRejectedValueOnce(new Error('Native dialog unavailable'))
    await expect(showStartupRecovery()).resolves.toBeUndefined()
    expect(native.quit).toHaveBeenCalledOnce()
    expect(await readFile(join(native.dataFolder, 'cv_filter.db'))).toEqual(preservedBytes)
  })
})
