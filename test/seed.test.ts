import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: {
    setName: vi.fn(),
    requestSingleInstanceLock: vi.fn(),
    whenReady: vi.fn(),
    exit: vi.fn()
  },
  setEntryDir: vi.fn(),
  collectFiles: vi.fn(),
  ingestFile: vi.fn(),
  ingestText: vi.fn(),
  stats: vi.fn()
}))

// Never boot Electron, load native database code, or touch the real library.
vi.mock('electron', () => ({ app: mocks.app }))
vi.mock('../src/main/embed/client.js', () => ({ setEntryDir: mocks.setEntryDir }))
vi.mock('../src/main/ingest/pipeline.js', () => ({
  collectFiles: mocks.collectFiles,
  ingestFile: mocks.ingestFile,
  ingestText: mocks.ingestText
}))
vi.mock('../src/main/db/index.js', () => ({ stats: mocks.stats }))
vi.mock('./fixtures/corpus.js', () => ({
  RESUMES: [{ id: 'test', text: 'Test Candidate\nSoftware engineer' }]
}))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('real-library seeder startup', () => {
  it('exits without starting work when another process owns the library', async () => {
    mocks.app.requestSingleInstanceLock.mockReturnValue(false)

    await import('../src/main/seed.js')

    expect(mocks.app.setName).toHaveBeenCalledWith('cv-filter')
    expect(mocks.app.setName.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.app.requestSingleInstanceLock.mock.invocationCallOrder[0]
    )
    expect(mocks.app.exit).toHaveBeenCalledWith(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Close it and retry'))
    expect(mocks.app.whenReady).not.toHaveBeenCalled()
    expect(mocks.setEntryDir).not.toHaveBeenCalled()
    expect(mocks.collectFiles).not.toHaveBeenCalled()
    expect(mocks.ingestFile).not.toHaveBeenCalled()
    expect(mocks.ingestText).not.toHaveBeenCalled()
    expect(mocks.stats).not.toHaveBeenCalled()
  })

  it('acquires the library lock and waits for Electron before seeding', async () => {
    let ready!: () => void
    mocks.app.whenReady.mockReturnValue(new Promise<void>((resolve) => {
      ready = resolve
    }))
    mocks.app.requestSingleInstanceLock.mockReturnValue(true)
    mocks.collectFiles.mockResolvedValue([])
    mocks.ingestText.mockResolvedValue({ status: 'imported' })
    mocks.stats.mockReturnValue({ resumeCount: 1, chunkCount: 1 })

    await import('../src/main/seed.js')

    expect(mocks.app.requestSingleInstanceLock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.app.whenReady.mock.invocationCallOrder[0]
    )
    expect(mocks.setEntryDir).not.toHaveBeenCalled()
    expect(mocks.collectFiles).not.toHaveBeenCalled()
    expect(mocks.ingestText).not.toHaveBeenCalled()
    expect(mocks.stats).not.toHaveBeenCalled()
    expect(mocks.app.exit).not.toHaveBeenCalled()

    ready()
    await vi.dynamicImportSettled()

    expect(mocks.ingestText).toHaveBeenCalledWith({
      text: 'Test Candidate\nSoftware engineer',
      fileName: 'test-candidate.md',
      filePath: '',
      fileType: 'pasted'
    })
    expect(mocks.stats).toHaveBeenCalledOnce()
    expect(mocks.app.exit).toHaveBeenCalledWith(0)
  })
})
