// Suppressing the clock's keyboard shortcuts. WATER is a focus mode: it empties
// every other layer so the supply network is read against an empty city, and
// the supply network has no time dimension at all — nothing on it moves, and
// nothing about it differs between 03:00 and 18:00. So while WATER is on, App
// takes the clock and the timeline bar OFF the screen entirely (they are
// unmounted, not dimmed).
//
// That leaves exactly one way to still drive the clock: the keyboard. Space
// still reaches the window listener with no visible control to explain what it
// did, so the listener has to opt out too — and this is the predicate it asks.
// Kept in its own module, and pure, so the rule is testable without a DOM and
// stays in one place if more clock shortcuts are added later.

// `locked` — the clock UI is off the screen (WATER focus mode).
// `ownsKeyboard` — a native input, button or link owns the key (including Space).
// The caller checks the focused DOM element; this predicate stays DOM-independent.
export function ignoreClockShortcut(locked: boolean, ownsKeyboard: boolean): boolean {
  return locked || ownsKeyboard
}
