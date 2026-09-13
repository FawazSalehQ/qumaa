/** One bounded search kept only in process memory until explicitly saved. */
import { jobRecordSchema, snapshotRecordSchema, RECRUITING_LIMITS, parseRecruiting, type JobRecord, type SnapshotRecord } from './schema.js'
import type { SearchSession } from '../search/sessions.js'

interface TemporarySearch { job: JobRecord; snapshot: SnapshotRecord }

export class TemporarySearchStore {
  private current: TemporarySearch | null = null
  private displayedSession: SearchSession | null = null
  private generation = 0

  get id(): string | null { return this.current?.job.id ?? null }

  begin(): number { return ++this.generation }

  get(id: string): TemporarySearch | null {
    return this.current?.job.id === id ? structuredClone(this.current) : null
  }

  publish(generation: number, value: TemporarySearch): void {
    if (generation !== this.generation) throw new Error('This temporary search changed. Run the search again.')
    const job = parseRecruiting(jobRecordSchema, value.job)
    const snapshot = parseRecruiting(snapshotRecordSchema, value.snapshot)
    if (job.id !== snapshot.jobId) throw new Error('The temporary search identity does not match its results.')
    if (Buffer.byteLength(JSON.stringify({ job, snapshot })) > RECRUITING_LIMITS.recordBytes) throw new Error('This temporary search exceeds the storage limit.')
    this.current = { job, snapshot }
    this.displayedSession = null
  }

  // Local save/export remain available after Claude's bounded session cache
  // expires. Retain only the latest displayed, already bounded result set;
  // snapshot/library validation still runs before either operation.
  rememberSession(session: SearchSession): void {
    if (session.job?.jobId === this.id) this.displayedSession = structuredClone(session)
  }

  getSession(id: string): SearchSession | null {
    return this.displayedSession?.id === id ? structuredClone(this.displayedSession) : null
  }

  updateSnapshot(id: string, snapshot: SnapshotRecord): void {
    const current = this.get(id)
    if (!current) throw new Error('This temporary search is no longer available.')
    this.publish(this.generation, { job: current.job, snapshot })
  }

  discard(id: string): boolean {
    if (this.current?.job.id !== id) return false
    this.clear()
    return true
  }

  clear(): void {
    ++this.generation
    this.current = null
    this.displayedSession = null
  }

  prune(currentKeys: Set<string>): void {
    if (!this.current) return
    const { rerank, rerankConfig, ...snapshot } = this.current.snapshot
    this.current.snapshot = {
      ...snapshot,
      results: snapshot.results.filter((result) => currentKeys.has(result.recordKey)),
      ...(rerank?.every((entry) => currentKeys.has(entry.recordKey)) ? { rerank, ...(rerankConfig ? { rerankConfig } : {}) } : {})
    }
    this.displayedSession = null
  }
}

export const temporarySearch = new TemporarySearchStore()
