/**
 * Single-flight readiness barrier for the on-disk search index.
 *
 * Loading the model is not enough to make search safe: a model migration may
 * still be rewriting stored vectors, and derived metadata may still be being
 * backfilled. Callers wait on this barrier, which only opens after the whole
 * initialization sequence succeeds.
 */
type IndexReadinessStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; message: string }

type Initializer = () => Promise<void>

export class IndexReadiness {
  private completion: Promise<void> | null = null
  private status: IndexReadinessStatus = { state: 'idle' }

  getStatus(): IndexReadinessStatus {
    return this.status
  }

  /** Starts initialization once. Every caller observes the same completion. */
  start(initializer: Initializer): Promise<void> {
    if (this.completion) return this.completion

    this.status = { state: 'loading' }

    this.completion = Promise.resolve()
      .then(initializer)
      .then(
        () => {
          this.status = { state: 'ready' }
        },
        (reason: unknown) => {
          const error = reason instanceof Error ? reason : new Error(String(reason))
          this.status = { state: 'error', message: error.message }
          throw error
        }
      )

    return this.completion
  }

  /** Rejects after a failed initialization instead of letting work proceed. */
  waitUntilReady(): Promise<void> {
    return (
      this.completion ??
      Promise.reject(new Error('Search index initialization has not started.'))
    )
  }
}

/** Process-wide barrier shared by IPC handlers and the watched-folder service. */
export const indexReadiness = new IndexReadiness()
