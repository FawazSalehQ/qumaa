import { describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertModelFile,
  assertExactModelTree,
  inspectModelFile,
  ModelIntegrityError
} from '../scripts/model-integrity.mjs'
import { MODEL_ID, MODEL_REVISION } from '../src/main/embed/protocol.js'
import { temporaryDirectories } from './fixtures/temporary.js'

const scratch = temporaryDirectories('qumaa-model-integrity-')

async function fixture(contents: string): Promise<string> {
  const directory = await scratch.create()
  const path = join(directory, 'model.bin')
  await writeFile(path, contents)
  return path
}

describe('model integrity', () => {
  it('keeps runtime vector provenance aligned with the build manifest', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../scripts/model-manifest.json', import.meta.url), 'utf8')
    ) as { modelId: string; revision: string }
    expect(MODEL_ID).toBe(manifest.modelId)
    expect(MODEL_REVISION).toBe(manifest.revision)
  })

  it('accepts a file only when its byte length and SHA-256 both match', async () => {
    const path = await fixture('Qumaa')
    const expected = await inspectModelFile(path)

    await expect(
      assertModelFile(path, { path: 'model.bin', ...expected })
    ).resolves.toEqual(expected)
  })

  it('rejects same-sized content with the wrong SHA-256', async () => {
    const trusted = await fixture('trusted')
    const changed = await fixture('altered')
    const expected = await inspectModelFile(trusted)

    await expect(
      assertModelFile(changed, { path: 'model.bin', ...expected })
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'ModelIntegrityError',
        message: expect.stringContaining('SHA-256 mismatch')
      })
    )
  })

  it('rejects a truncated file before it can be trusted', async () => {
    const path = await fixture('short')

    await expect(
      assertModelFile(path, {
        path: 'model.bin',
        size: 100,
        sha256: '0'.repeat(64)
      })
    ).rejects.toBeInstanceOf(ModelIntegrityError)
  })

  it('rejects unlisted files from the packaged model directory', async () => {
    const directory = await scratch.create()
    await mkdir(join(directory, 'onnx'))
    await writeFile(join(directory, 'config.json'), '{}')
    await writeFile(join(directory, 'onnx', 'model.onnx'), 'model')
    const files = [{ path: 'config.json' }, { path: 'onnx/model.onnx' }]

    await expect(assertExactModelTree(directory, files)).resolves.toBeUndefined()
    await writeFile(join(directory, 'secret.txt'), 'must not be packaged')
    await expect(assertExactModelTree(directory, files)).rejects.toThrow('unexpected: secret.txt')
  })
})
