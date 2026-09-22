// Keep keyboard shortcuts out of native controls and explicitly locked UIs.
// The clock UI is unavailable when every transport layer is off.
export function ignoreClockShortcut(locked: boolean, ownsKeyboard: boolean): boolean {
  return locked || ownsKeyboard
}
