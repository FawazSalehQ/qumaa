/**
 * Remembers the window's size and position between launches.
 *
 * Stored in the existing `settings` table through getSetting/setSetting, so
 * there is no schema change and no extra file to manage.
 */
import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { getSetting, setSetting } from './db/index.js'

const KEY = 'windowState'

const DEFAULTS = { width: 1280, height: 860 }
export const MIN_WIDTH = 940
export const MIN_HEIGHT = 620

interface WindowState extends Rectangle {
  maximized: boolean
}

function parse(raw: string | null): WindowState | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Partial<WindowState>
    if (
      typeof s.x !== 'number' ||
      typeof s.y !== 'number' ||
      typeof s.width !== 'number' ||
      typeof s.height !== 'number'
    ) {
      return null
    }
    return { x: s.x, y: s.y, width: s.width, height: s.height, maximized: Boolean(s.maximized) }
  } catch {
    return null
  }
}

/**
 * Drops a saved position that no longer lands on a connected display.
 *
 * Without this, a window last used on a second monitor reopens off-screen after
 * that monitor is unplugged, and there is no way to drag it back.
 */
function isOnSomeDisplay(state: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const a = display.workArea
    // Require a decent overlap, not just a shared pixel, so a window peeking in
    // from the edge is still treated as lost.
    const overlapX = Math.min(state.x + state.width, a.x + a.width) - Math.max(state.x, a.x)
    const overlapY = Math.min(state.y + state.height, a.y + a.height) - Math.max(state.y, a.y)
    return overlapX > 120 && overlapY > 80
  })
}

/** Window options to open with: the saved geometry when it is still usable. */
export function restoredBounds(): {
  options: Partial<Rectangle> & { width: number; height: number }
  maximized: boolean
} {
  const saved = parse(getSetting(KEY))
  if (!saved || !isOnSomeDisplay(saved)) {
    return { options: { ...DEFAULTS }, maximized: false }
  }
  return {
    options: {
      x: saved.x,
      y: saved.y,
      width: Math.max(MIN_WIDTH, saved.width),
      height: Math.max(MIN_HEIGHT, saved.height)
    },
    maximized: saved.maximized
  }
}

/**
 * Persists geometry on resize, move and close.
 *
 * `getNormalBounds` rather than `getBounds`: while maximized the latter reports
 * the full screen, which would restore as a maximized-sized non-maximized window.
 */
export function trackWindow(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null

  const save = (): void => {
    if (win.isDestroyed()) return
    const bounds = win.getNormalBounds()
    setSetting(
      KEY,
      JSON.stringify({ ...bounds, maximized: win.isMaximized() } satisfies WindowState)
    )
  }

  // Resize and move fire continuously while dragging; only write once it settles.
  const debounced = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 400)
  }

  win.on('resize', debounced)
  win.on('move', debounced)
  win.on('maximize', debounced)
  win.on('unmaximize', debounced)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    save()
  })
}
