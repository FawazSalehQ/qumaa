/** Promise helpers shared by the scheduling, gate and session tests. */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** Lets every queued microtask and timer-0 callback run before the next assertion. */
export async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
