/**
 * Two themes, chosen by the user and remembered across restarts.
 *
 * The theme lives on <html data-theme>, so the CSS in styles.css can key off it and the
 * whole page flips at once.  A stored value that is not one of the two themes is ignored
 * rather than half-applied, so a corrupted entry cannot produce an unreadable page.
 */

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

const STORAGE_KEY = 'vision:theme'

export const isTheme = (value: unknown): value is Theme =>
  typeof value === 'string' && (THEMES as readonly string[]).includes(value)

function storage(): Storage | null {
  try {
    // Private browsing and a WebView with no storage both make this throw.
    return window.localStorage
  } catch {
    return null
  }
}

/** The stored theme, or null when the user has never chosen one. */
export function storedTheme(): Theme | null {
  try {
    const value = storage()?.getItem(STORAGE_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

/** The theme to show: the stored choice, otherwise the one the system prefers. */
export function preferredTheme(): Theme {
  const stored = storedTheme()
  if (stored) return stored
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  // Tells the browser to use its own dark form controls and scrollbars for this theme.
  document.documentElement.style.colorScheme = theme
}

export function storeTheme(theme: Theme): void {
  try {
    storage()?.setItem(STORAGE_KEY, theme)
  } catch {
    /* a theme that cannot be remembered still applies for this session */
  }
}

export function setTheme(theme: Theme): void {
  applyTheme(theme)
  storeTheme(theme)
}

export function toggleTheme(): Theme {
  const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

/**
 * Apply the theme before the first paint.  Called from index.html so the page never
 * flashes the wrong background while the app boots.
 */
export function initTheme(): Theme {
  const theme = preferredTheme()
  applyTheme(theme)
  return theme
}
