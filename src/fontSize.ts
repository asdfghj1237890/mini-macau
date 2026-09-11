import { useSyncExternalStore } from 'react'

export const FONT_SIZE_MIN = 90
export const FONT_SIZE_MAX = 150
export const FONT_SIZE_STEP = 10
export const FONT_SIZE_DEFAULT = 100
const STORAGE_KEY = 'mini-macau-font-size'
const listeners = new Set<() => void>()

function normalize(value: number): number {
  if (!Number.isFinite(value)) return FONT_SIZE_DEFAULT
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value / FONT_SIZE_STEP) * FONT_SIZE_STEP))
}

function read(): number {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === null || value.trim() === '' ? FONT_SIZE_DEFAULT : normalize(Number(value))
  } catch {
    return FONT_SIZE_DEFAULT
  }
}

let current = read()

function apply(): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--mm-font-scale', String(current / 100))
  document.documentElement.dataset.largeText = String(current >= 130)
}

// Imported by main before rendering, including when the map uses 2D fallback.
// Only typography changes: map projection, control geometry and camera stay put.
apply()

export function getFontSize(): number { return current }

export function setFontSize(value: number): void {
  const next = normalize(value)
  if (next === current) return
  current = next
  apply()
  try {
    localStorage.setItem(STORAGE_KEY, String(current))
  } catch {
    // Blocked storage still allows the preference to work for this session.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useFontSize(): number {
  return useSyncExternalStore(subscribe, getFontSize, () => FONT_SIZE_DEFAULT)
}
