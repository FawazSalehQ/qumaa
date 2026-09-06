import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  created: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  loadURL: vi.fn(),
  printToPDF: vi.fn(),
  destroy: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: unknown) { calls.created(options) }
    loadURL = calls.loadURL
    webContents = { printToPDF: calls.printToPDF }
    isDestroyed(): boolean { return false }
    destroy = calls.destroy
  }
}))
vi.mock('node:fs/promises', () => ({ readFile: calls.readFile, writeFile: calls.writeFile }))

import { writeShortlistPdf } from '../src/main/export/shortlist.js'

describe('offline shortlist fonts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    calls.readFile.mockResolvedValue(Buffer.from('bundled-font'))
    calls.loadURL.mockResolvedValue(undefined)
    calls.printToPDF.mockResolvedValue(Buffer.from('%PDF-demo'))
    calls.writeFile.mockResolvedValue(undefined)
  })

  it('inlines both bundled Arabic weights before loading the script-free print document', async () => {
    await writeShortlistPdf('<html lang="ar" dir="rtl"><head></head><body>مرشح</body></html>', '/demo.pdf')
    expect(calls.readFile).toHaveBeenCalledTimes(2)
    expect(calls.readFile.mock.calls.map(([path]) => String(path)).join(' ')).toContain('arabic-400-normal')
    expect(calls.readFile.mock.calls.map(([path]) => String(path)).join(' ')).toContain('arabic-600-normal')
    const loaded = decodeURIComponent(calls.loadURL.mock.calls[0][0])
    expect(loaded.match(/data:font\/woff2;base64,YnVuZGxlZC1mb250/g)).toHaveLength(2)
    expect(loaded).toContain('مرشح')
    expect(loaded).not.toMatch(/https?:|file:/)
    expect(calls.created).toHaveBeenCalledWith(expect.objectContaining({
      show: false,
      webPreferences: { offscreen: true, javascript: false, sandbox: true }
    }))
    expect(calls.writeFile).toHaveBeenCalledWith('/demo.pdf', Buffer.from('%PDF-demo'))
    expect(calls.destroy).toHaveBeenCalledOnce()
  })

  it('reports a missing bundled font before printing a potentially unreadable PDF', async () => {
    calls.readFile.mockRejectedValueOnce(new Error('Missing font asset'))
    await expect(writeShortlistPdf('<html><head></head></html>', '/demo.pdf')).rejects.toThrow('Missing font asset')
    expect(calls.created).not.toHaveBeenCalled()
    expect(calls.writeFile).not.toHaveBeenCalled()
  })
})
