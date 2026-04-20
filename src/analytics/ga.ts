/**
 * GA4 analytics — typed gtag() wrapper + visibility- and idle-aware
 * engagement tracker.
 *
 * Why a custom tracker when GA4 already emits user_engagement?
 *
 * GA4's auto `user_engagement` event accrues while the tab is merely
 * visible — it doesn't check whether the user is actually there. For
 * Mini Map Macau that's a real problem: users routinely open the tab
 * and walk away for half an hour (it's a passive map to glance at),
 * which would otherwise inflate "engaged time" and bias every dashboard
 * downstream. So we run our own counter that:
 *
 *   • only advances while document.visibilityState === 'visible'
 *   • only advances while there's been input (mouse / key / touch /
 *     scroll / wheel) within IDLE_THRESHOLD_MS
 *
 * and emits:
 *
 *   • `engaged_time_milestone` at 30s / 1m / 3m / 5m / 10m / 20m /
 *     30m / 1h / 2h of real active dwell (one-shot each per session)
 *   • `dwell_heartbeat` every 10 minutes of active dwell (so extremely
 *     long sessions remain distinguishable from medium ones)
 *   • `dwell_idle_start` / `dwell_idle_end` when input stops/resumes
 *   • `tab_backgrounded` / `tab_foregrounded` on visibility change
 *   • `session_end` on pagehide with the final totals
 *
 * All tracking is best-effort — every gtag call is wrapped in a
 * try/catch because analytics must never break the app.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

export type EventParams = Record<string, string | number | boolean | undefined>

/**
 * Fire a GA4 event. Swallows all errors — analytics bugs must never
 * surface to the user. No-ops on the server / in tests where window
 * isn't defined or gtag isn't installed.
 */
export function track(eventName: string, params?: EventParams): void {
  try {
    if (typeof window === 'undefined') return
    const gtag = window.gtag
    if (typeof gtag !== 'function') return
    gtag('event', eventName, params ?? {})
  } catch { /* swallow */ }
}

// ---------------------------------------------------------------------
// Engagement tracker
// ---------------------------------------------------------------------

// Active-dwell milestones (ms). Must be monotonic ascending.
const MILESTONES_MS: readonly number[] = [
  30_000,     // 30s
  60_000,     // 1m
  180_000,    // 3m
  300_000,    // 5m
  600_000,    // 10m
  1_200_000,  // 20m
  1_800_000,  // 30m
  3_600_000,  // 1h
  7_200_000,  // 2h
]

// Time without input after which we consider the user idle.
const IDLE_THRESHOLD_MS = 30_000

// Heartbeat cadence (in active-dwell-ms, not wall clock).
const HEARTBEAT_MS = 600_000 // 10 min

// Internal tick granularity for the dwell counter. Coarse enough that
// it doesn't show up in a flame graph, fine enough that milestones fire
// within ~1s of the true crossing time.
const TICK_MS = 1_000

// Activity events that count as "user is here". Passive + capture so
// they don't interfere with app handlers and don't force React to
// re-render on every mousemove.
const ACTIVITY_EVENTS: readonly (keyof WindowEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'pointerdown',
  'wheel',
  'scroll',
]

interface TrackerState {
  activeDwellMs: number
  lastActivityAt: number
  lastTickAt: number
  nextMilestoneIdx: number
  nextHeartbeatMs: number
  idle: boolean
  hidden: boolean
}

/**
 * Start the engagement tracker. Call once at app mount; the returned
 * disposer tears everything down (listeners + timer). Safe to call
 * multiple times (each call is independent) — but typically only one
 * instance should exist per document.
 */
export function startEngagementTracker(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => { /* noop */ }
  }

  const s: TrackerState = {
    activeDwellMs: 0,
    lastActivityAt: Date.now(),
    lastTickAt: Date.now(),
    nextMilestoneIdx: 0,
    nextHeartbeatMs: HEARTBEAT_MS,
    idle: false,
    hidden: document.visibilityState === 'hidden',
  }

  const onActivity = (): void => {
    const now = Date.now()
    s.lastActivityAt = now
    if (s.idle) {
      s.idle = false
      track('dwell_idle_end', {
        dwell_sec: Math.round(s.activeDwellMs / 1000),
      })
    }
  }

  const onVisibility = (): void => {
    const hidden = document.visibilityState === 'hidden'
    if (hidden === s.hidden) return
    s.hidden = hidden
    track(hidden ? 'tab_backgrounded' : 'tab_foregrounded', {
      dwell_sec: Math.round(s.activeDwellMs / 1000),
    })
    if (!hidden) {
      // Returning to the tab counts as activity. Reset the activity
      // timestamp so the first tick after returning doesn't immediately
      // trip the idle threshold based on stale pre-background data.
      const now = Date.now()
      s.lastActivityAt = now
      s.lastTickAt = now
    }
  }

  const tick = (): void => {
    const now = Date.now()
    const dt = now - s.lastTickAt
    s.lastTickAt = now

    const active = !s.hidden && (now - s.lastActivityAt) < IDLE_THRESHOLD_MS

    if (active) {
      s.activeDwellMs += dt

      // One-shot milestone events. while-loop in case dt > several
      // milestone gaps (unlikely with a 1s tick, but cheap to be safe).
      while (
        s.nextMilestoneIdx < MILESTONES_MS.length
        && s.activeDwellMs >= MILESTONES_MS[s.nextMilestoneIdx]
      ) {
        const threshold = MILESTONES_MS[s.nextMilestoneIdx]
        track('engaged_time_milestone', {
          milestone_sec: Math.round(threshold / 1000),
          dwell_sec: Math.round(s.activeDwellMs / 1000),
        })
        s.nextMilestoneIdx += 1
      }

      // Periodic heartbeat once the 10-min mark is passed. Spaced in
      // active-dwell time so a tab left open all day but only used for
      // 2 minutes still only emits 0 heartbeats.
      if (s.activeDwellMs >= s.nextHeartbeatMs) {
        track('dwell_heartbeat', {
          dwell_sec: Math.round(s.activeDwellMs / 1000),
          heartbeat_n: Math.round(s.activeDwellMs / HEARTBEAT_MS),
        })
        s.nextHeartbeatMs += HEARTBEAT_MS
      }
    } else if (!s.idle && !s.hidden) {
      s.idle = true
      track('dwell_idle_start', {
        dwell_sec: Math.round(s.activeDwellMs / 1000),
      })
    }
  }

  const tickId = window.setInterval(tick, TICK_MS)

  for (const ev of ACTIVITY_EVENTS) {
    window.addEventListener(ev, onActivity, { passive: true, capture: true })
  }
  document.addEventListener('visibilitychange', onVisibility)

  // pagehide fires more reliably than unload on mobile; GA4's transport
  // auto-switches to sendBeacon during unload so the last event still
  // lands on Google's side even though the page is dying.
  const onPageHide = (): void => {
    track('session_end', {
      dwell_sec: Math.round(s.activeDwellMs / 1000),
      milestones_hit: s.nextMilestoneIdx,
    })
  }
  window.addEventListener('pagehide', onPageHide)

  return () => {
    window.clearInterval(tickId)
    for (const ev of ACTIVITY_EVENTS) {
      window.removeEventListener(ev, onActivity, { capture: true })
    }
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
  }
}

// ---------------------------------------------------------------------
// Semantic helpers — one place to own event names + param shapes so
// component code doesn't have to remember the exact string.
// ---------------------------------------------------------------------

export const ga = {
  vehicleSelected(type: string, id: string): void {
    track('vehicle_selected', { vehicle_type: type, vehicle_id: id })
  },
  stationSelected(id: string): void {
    track('station_selected', { station_id: id })
  },
  languageChanged(from: string, to: string, source: 'app' | 'thank_you' = 'app'): void {
    track('language_changed', { lang_from: from, lang_to: to, source })
  },
  simPauseToggled(paused: boolean): void {
    track(paused ? 'sim_paused' : 'sim_resumed')
  },
  simSpeedChanged(speed: number): void {
    track('sim_speed_changed', { speed })
  },
  layerToggled(layer: string, enabled: boolean): void {
    track('layer_toggled', { layer, enabled })
  },
  viewModeChanged(mode: '2d' | '3d'): void {
    track('view_mode_changed', { mode })
  },
  themeChanged(theme: 'dark' | 'light'): void {
    track('theme_changed', { theme })
  },
  drawerOpened(): void {
    track('drawer_opened')
  },
  timeJumped(deltaHours: number): void {
    track('time_jumped', { delta_hours: Math.round(deltaHours * 10) / 10 })
  },
  vehicleTracked(type: string, id: string): void {
    track('vehicle_tracked', { vehicle_type: type, vehicle_id: id })
  },
}
