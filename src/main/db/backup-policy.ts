/** Settings that are meaningful and safe when moved to another computer. */
export const PORTABLE_SETTING_KEYS = ['theme', 'language'] as const

const PORTABLE_SETTINGS = new Set<string>(PORTABLE_SETTING_KEYS)

/** Secrets, local paths, window geometry, and unknown future settings stay local. */
export function isPortableSetting(key: string): boolean {
  return PORTABLE_SETTINGS.has(key)
}
