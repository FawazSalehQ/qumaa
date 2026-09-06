import { describe, expect, it, vi } from 'vitest'
import { copyResumeRefs, resolveNativeFilePaths } from '../src/preload/bridge-input.js'

describe('preload bridge input', () => {
  it('never calls a renderer-owned map function to resolve dropped files', () => {
    const rendererMap = vi.fn(() => ['/Users/victim/private.md'])
    const resolver = vi.fn()

    expect(() => resolveNativeFilePaths({ map: rendererMap }, resolver)).toThrow(
      'bounded array'
    )
    expect(rendererMap).not.toHaveBeenCalled()
    expect(resolver).not.toHaveBeenCalled()
  })

  it('requires every dropped item to resolve as a native-backed file', () => {
    const first = {}
    const second = {}
    expect(() =>
      resolveNativeFilePaths([first, second], (file) => (file === first ? '/safe/one.pdf' : ''))
    ).toThrow('native-backed file')
  })

  it('copies resume references with trusted iteration', () => {
    const refs = [{ id: 7, recordKey: 'a'.repeat(64) }]
    Object.defineProperty(refs, 'map', {
      value: vi.fn(() => [{ id: 99, recordKey: 'b'.repeat(64) }])
    })

    expect(copyResumeRefs(refs)).toEqual([{ id: 7, recordKey: 'a'.repeat(64) }])
    expect(refs.map).not.toHaveBeenCalled()
  })
})
