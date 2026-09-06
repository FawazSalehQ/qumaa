const MAX_BRIDGE_ITEMS = 5_000

/**
 * Copies destructive references without calling renderer-owned array methods.
 * The main process still performs the authoritative schema validation.
 */
export function copyResumeRefs(value: unknown): Array<{ id: number; recordKey: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BRIDGE_ITEMS) {
    throw new TypeError('Resume references must be a non-empty bounded array.')
  }

  const copied: Array<{ id: number; recordKey: string }> = []
  for (let index = 0; index < value.length; index++) {
    const item: unknown = value[index]
    if (typeof item !== 'object' || item === null) {
      throw new TypeError('Each resume reference must be an object.')
    }
    const candidate = item as { id?: unknown; recordKey?: unknown }
    if (typeof candidate.id !== 'number' || typeof candidate.recordKey !== 'string') {
      throw new TypeError('Each resume reference must contain an id and record key.')
    }
    copied.push({ id: candidate.id, recordKey: candidate.recordKey })
  }
  return copied
}

/**
 * Resolves only genuine native-backed File values, using trusted iteration.
 * In particular, a renderer object cannot provide its own `map()` function and
 * substitute arbitrary filesystem paths.
 */
export function resolveNativeFilePaths(
  value: unknown,
  resolvePath: (file: unknown) => string
): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BRIDGE_ITEMS) {
    throw new TypeError('Dropped files must be a non-empty bounded array.')
  }

  const paths: string[] = []
  for (let index = 0; index < value.length; index++) {
    const path = resolvePath(value[index])
    if (typeof path !== 'string' || path.length === 0) {
      throw new TypeError('Every dropped item must be a native-backed file.')
    }
    paths.push(path)
  }
  return paths
}
