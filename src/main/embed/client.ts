/**
 * Main-process handle to the embedding utility process.
 *
 * Exposes passage/query embedding, applying the BGE asymmetry rule (queries get
 * the instruction prefix, passages do not) so callers cannot get it wrong.
 */
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import {
  EMBEDDING_DIM,
  MODEL_ID,
  QUERY_PREFIX,
  type FromWorker,
  type ToWorker
} from './protocol.js'
import type { ModelStatus } from '@shared/types.js'

/** Keeps peak memory bounded during bulk import; ~32 chunks per forward pass. */
const BATCH_SIZE = 32

/**
 * Directory of the running main-process entry file (out/main).
 *
 * It cannot be derived here with `__dirname`: this module is bundled into a
 * shared chunk under out/main/chunks/, so its own `__dirname` is one level too
 * deep. `app.getAppPath()` is not reliable either, because it points at the project
 * root under `electron-vite dev`, but at the script's own directory when an
 * entry is launched directly. So each entry point registers its `__dirname`.
 */
let entryDir: string | null = null

export function setEntryDir(dir: string): void {
  entryDir = dir
}

interface Pending {
  resolve: (vectors: Float32Array[]) => void
  reject: (err: Error) => void
  count: number
}

class Embedder {
  private child: UtilityProcess | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private ready: Promise<void> | null = null
  private status: ModelStatus = { state: 'loading' }
  /** Serialises requests so we never have two forward passes in flight. */
  private queue: Promise<unknown> = Promise.resolve()

  getStatus(): ModelStatus {
    return this.status
  }

  private baseDir(): string {
    if (!entryDir) throw new Error('setEntryDir() was not called by the main entry point')
    return entryDir
  }

  private modelDir(): string {
    // Packaged: extraResources puts the model beside the asar. Dev: entryDir is
    // out/main, so the project root is two levels up.
    return app.isPackaged
      ? join(process.resourcesPath, 'models')
      : join(this.baseDir(), '..', '..', 'resources', 'models')
  }

  private workerPath(): string {
    // The worker is emitted as a sibling of the running entry file.
    return join(this.baseDir(), 'embed-worker.js')
  }

  start(): Promise<void> {
    if (this.ready) return this.ready

    this.ready = new Promise<void>((resolve, reject) => {
      const child = utilityProcess.fork(this.workerPath(), [], {
        serviceName: 'cv-filter-embedder',
        env: { ...process.env, CV_FILTER_MODEL_DIR: this.modelDir() },
        stdio: 'inherit'
      })
      this.child = child

      child.on('message', (msg: FromWorker) => {
        if (msg.type === 'ready') {
          this.status = { state: 'ready', dimensions: msg.dimensions }
          resolve()
          return
        }
        if (msg.type === 'error') {
          if (msg.id === null) {
            this.status = { state: 'error', message: msg.message }
            reject(new Error(msg.message))
            return
          }
          this.pending.get(msg.id)?.reject(new Error(msg.message))
          this.pending.delete(msg.id)
          return
        }
        if (msg.type === 'result') {
          const p = this.pending.get(msg.id)
          if (!p) return
          this.pending.delete(msg.id)
          // Split the flat buffer back into one vector per input text.
          const vectors: Float32Array[] = []
          for (let i = 0; i < msg.count; i++) {
            vectors.push(msg.vectors.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM))
          }
          p.resolve(vectors)
        }
      })

      child.on('exit', (code) => {
        const err = new Error(`Embedding process exited (code ${code})`)
        for (const p of this.pending.values()) p.reject(err)
        this.pending.clear()
        this.child = null
        this.ready = null
        if (this.status.state !== 'error') {
          this.status = { state: 'error', message: err.message }
        }
      })
    })

    return this.ready
  }

  private request(texts: string[]): Promise<Float32Array[]> {
    return new Promise((resolve, reject) => {
      if (!this.child) return reject(new Error('Embedder not started'))
      const id = this.nextId++
      this.pending.set(id, { resolve, reject, count: texts.length })
      const msg: ToWorker = { type: 'embed', id, texts }
      this.child.postMessage(msg)
    })
  }

  /** Batches, and serialises batches through a single chain. */
  private async embedAll(texts: string[]): Promise<Float32Array[]> {
    await this.start()
    if (texts.length === 0) return []

    const run = async (): Promise<Float32Array[]> => {
      const out: Float32Array[] = []
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        out.push(...(await this.request(texts.slice(i, i + BATCH_SIZE))))
      }
      return out
    }

    const chained = this.queue.then(run, run)
    // Keep the chain alive even if this call rejects.
    this.queue = chained.catch(() => undefined)
    return chained
  }

  /** Resume chunks, with no prefix. */
  embedPassages(texts: string[]): Promise<Float32Array[]> {
    return this.embedAll(texts)
  }

  /** Job-description text, instruction-prefixed. */
  embedQueries(texts: string[]): Promise<Float32Array[]> {
    return this.embedAll(texts.map((t) => QUERY_PREFIX + t))
  }

  stop(): void {
    this.child?.postMessage({ type: 'shutdown' } satisfies ToWorker)
    this.child = null
    this.ready = null
  }
}

export const embedder = new Embedder()
export { EMBEDDING_DIM, MODEL_ID }
