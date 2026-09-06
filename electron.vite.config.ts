import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Main and preload are emitted as CommonJS, which is electron-vite's default
// and the format every runtime dependency here ships (transformers, unpdf, mammoth and
// better-sqlite3 all provide CJS builds).
//
// Native/heavy deps must stay external in the main bundle: better-sqlite3 and
// onnxruntime-node load `.node` binaries that a bundler cannot inline.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        // Workers are forked via utilityProcess so expensive/untrusted parsing
        // and model inference cannot stall or exhaust the main process.
        input: {
          index: resolve('src/main/index.ts'),
          'embed-worker': resolve('src/main/embed/worker.ts'),
          'extraction-worker': resolve('src/main/ingest/extraction-worker.ts'),
          // Headless integration check; see `npm run smoke`.
          smoke: resolve('src/main/smoke.ts'),
          // Dev-only library seeder; see `npm run seed`.
          seed: resolve('src/main/seed.ts'),
          // Capacity benchmark; see `npm run bench`.
          bench: resolve('src/main/bench.ts'),
          // Ranking-quality evaluation; see `npm run eval`.
          eval: resolve('src/main/eval.ts')
        },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
