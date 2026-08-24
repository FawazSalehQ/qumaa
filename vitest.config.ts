import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    include: ['test/**/*.test.ts'],
    // The ranking sanity test loads a real 113MB ONNX model.
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
