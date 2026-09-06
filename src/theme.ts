// The UI theme: dark (the default, and the only one until 2026-09) or light.
//
// One tiny external store rather than React state in MapView, because three
// things have to agree on it and none of them is the other's parent:
//   * the map — CARTO Dark Matter vs Positron (MapView swaps the style);
//   * every panel — the CSS custom properties in index.css switch on the
//     `data-theme` attribute this store writes to <html>;
//   * the legend swatches for the map's own animated colours, which differ per
//     theme (see waterMotionColors / powerMotionColors).
// The attribute is written at module load, before React renders, so a stored
// light theme never flashes dark on reload.
import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'

const LS_KEY = 'mini-macau-theme'
const listeners = new Set<() => void>()

function read(): Theme {
  try {
    return localStorage.getItem(LS_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

let current: Theme = read()

function apply(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  // Hint native widgets (scrollbars, form controls) too.
  document.documentElement.style.colorScheme = theme
}

apply(current)

export function getTheme(): Theme {
  return current
}

export function setTheme(theme: Theme): void {
  if (theme === current) return
  current = theme
  apply(theme)
  try {
    localStorage.setItem(LS_KEY, theme)
  } catch {
    // Storage may be blocked; the session still gets the theme.
  }
  for (const cb of listeners) cb()
}

export function toggleTheme(): Theme {
  const next: Theme = current === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// The React view of the store. Components that only style themselves via CSS
// need nothing — the custom properties follow the attribute — so this is for
// the few that pick a colour in JS: the map and the legend swatches.
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, getTheme)
}
