import type { JobPlacement, JobPlacementCandidate } from '@shared/recruiting.js'
import type { JobRecord } from './schema.js'

/** Ignore later name corrections when deciding whether selected people changed. */
export function samePlacementPeople(left?: JobPlacement, right?: JobPlacement): boolean {
  const identities = (value?: JobPlacement) => value ? [value.hired, value.backup2, value.backup3]
    .map((candidate) => candidate ? { recordKey: candidate.recordKey } : null) : null
  return JSON.stringify(identities(left)) === JSON.stringify(identities(right))
}

/** Keep decision dates while erasing deleted CV identities from every snapshot. */
export function pruneJobPlacements(job: JobRecord, currentKeys: Set<string>): JobRecord {
  let changed = false
  const candidate = (value: JobPlacementCandidate | null): JobPlacementCandidate | null => {
    if (!value?.recordKey || currentKeys.has(value.recordKey)) return value
    changed = true
    return { recordKey: null, name: null }
  }
  const placement = (value: JobPlacement): JobPlacement => ({
    hired: candidate(value.hired)!, backup2: candidate(value.backup2), backup3: candidate(value.backup3)
  })
  const result: JobRecord = {
    ...job,
    ...(job.placement ? { placement: placement(job.placement) } : {}),
    ...(job.statusHistory ? { statusHistory: job.statusHistory.map((event) => event.placement ? { ...event, placement: placement(event.placement) } : event) } : {})
  }
  return changed ? result : job
}
