import { useCallback, useEffect, useState } from 'react'
import type { ThemeChoice } from '@shared/types.js'

/**
 * Applies the theme to the document root, which is what the CSS selects on.
 *
 * "system" follows the OS and keeps following it: the media query listener stays
 * attached, so a machine that flips to dark at sunset takes the app with it
 * rather than needing a restart.
 */
export function useTheme(): { theme: ThemeChoice; setTheme: (t: ThemeChoice) => void } {
  const [theme, setThemeState] = useState<ThemeChoice>('system')

  useEffect(() => {
    window.api.settings.get().then((s) => setThemeState(s.theme))
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    }
    apply()
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t)
    window.api.settings.setTheme(t)
  }, [])

  return { theme, setTheme }
}
