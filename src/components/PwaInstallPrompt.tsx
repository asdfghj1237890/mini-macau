import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { ga } from '../analytics/ga'
import { usePwaInstall } from '../hooks/usePwaInstall'
import {
  beginInstallTracking,
  detectInstallPlatform,
  dismissInstall,
  installHintKey,
  isAndroidPlatform,
  isInstallDismissed,
  needsManualGuide,
  previewInstallPlatform,
  requestInstall,
  type InstallPlatform,
} from '../pwaInstall'

// How long each answer keeps the card away, in days.
const LATER_DAYS = 1
const ACKNOWLEDGED_DAYS = 30
const NATIVE_DISMISSED_DAYS = 14
const INSTALLED_DAYS = 365
const ERROR_DAYS = 1
// Browsers without an install event get the card once the map has settled.
const MANUAL_GUIDE_DELAY_MS = 2500

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    return window.localStorage
  } catch {
    // Storage access itself throws when a browser blocks site data.
    return { getItem: () => null, setItem: () => {} }
  }
}

interface Detection {
  platform: InstallPlatform | undefined
  /** `?install=<platform>`: show that card, remember nothing. */
  preview: boolean
  /** Answered within the memory window before this load. */
  dismissed: boolean
}

function detect(): Detection {
  const preview = previewInstallPlatform(window.location.search)
  if (preview) return { platform: preview, preview: true, dismissed: false }
  const platform = detectInstallPlatform(navigator)
  return {
    platform,
    preview: false,
    dismissed: platform ? isInstallDismissed(platform, safeStorage()) : false,
  }
}

/**
 * The add-to-home-screen card. iOS browsers and the Android vendor browsers
 * get one sentence naming their Share / menu route a moment after load;
 * Chrome on Android (and any Android browser that dispatches
 * `beforeinstallprompt`) gets a one-tap INSTALL the moment the browser
 * offers it. Every answer is remembered per browser in localStorage, the
 * drawer's APP row reopens the card regardless, and `?install=<platform>`
 * previews any variant anywhere.
 *
 * Visibility is derived, not synchronised: what the browser told us (the
 * store), what this load found (`detect`), whether the settle-down timer has
 * fired, and the drawer request the user last answered.
 */
export function PwaInstallPrompt() {
  const { t } = useI18n()
  const { installEvent, installed, guideRequest } = usePwaInstall()
  const [{ platform: detected, preview, dismissed }] = useState(detect)
  const [delayElapsed, setDelayElapsed] = useState(false)
  // The `guideRequest` value current when the user last answered the card;
  // null until they have. A newer request from the drawer reopens it.
  const [answeredAt, setAnsweredAt] = useState<number | null>(null)

  useEffect(() => beginInstallTracking(), [])

  useEffect(() => {
    if (!detected || preview || !needsManualGuide(detected)) return
    const timer = window.setTimeout(() => setDelayElapsed(true), MANUAL_GUIDE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [detected, preview])

  const openedByGuide = guideRequest > (answeredAt ?? 0)
  const platform = ((): InstallPlatform | null => {
    if (!detected) return null
    if (preview) return answeredAt === null ? detected : null
    if (installed) return null
    if (openedByGuide) return detected
    if (answeredAt !== null || dismissed) return null
    if (detected === 'android-chrome') return installEvent ? detected : null
    if (isAndroidPlatform(detected) && installEvent) return detected
    return delayElapsed ? detected : null
  })()

  // The card appearing on its own is worth a count; the drawer counts its
  // own openings, and a preview is nobody's behaviour.
  useEffect(() => {
    if (platform && !openedByGuide && !preview) ga.pwaInstallPrompt('shown', platform)
  }, [platform, openedByGuide, preview])

  // Installed — the page runs standalone, or we just watched it happen — so
  // the browser's memory can rest for a year.
  useEffect(() => {
    if (installed && detected && !preview) dismissInstall(detected, safeStorage(), INSTALLED_DAYS)
  }, [installed, detected, preview])

  const canInstallDirectly = isAndroidPlatform(platform) && installEvent !== null

  const answer = (days: number) => {
    if (platform && !preview) dismissInstall(platform, safeStorage(), days)
    setAnsweredAt(guideRequest)
  }

  const later = () => {
    if (platform) ga.pwaInstallPrompt('later', platform)
    answer(LATER_DAYS)
  }

  const installOrDismiss = async () => {
    if (!platform) return
    if (!canInstallDirectly) {
      // The manual-route card: GOT IT acknowledges the sentence, nothing installs.
      ga.pwaInstallPrompt('acknowledged', platform)
      answer(ACKNOWLEDGED_DAYS)
      return
    }
    // The browser owns the interaction from here. Hide first so the button
    // cannot flip from INSTALL to GOT IT while `userChoice` settles.
    const prompted = platform
    setAnsweredAt(guideRequest)
    let days = ERROR_DAYS
    try {
      const outcome = await requestInstall()
      ga.pwaInstallPrompt(outcome === 'accepted' ? 'accepted' : 'dismissed', prompted)
      days = outcome === 'accepted' ? INSTALLED_DAYS : NATIVE_DISMISSED_DAYS
    } catch {
      ga.pwaInstallPrompt('error', prompted)
    }
    if (!preview) dismissInstall(prompted, safeStorage(), days)
  }

  if (!platform) return null
  const hint = t.installAppHint(installHintKey(platform, installEvent !== null))

  return (
    <aside
      role="dialog"
      aria-labelledby="pwa-install-title"
      aria-describedby="pwa-install-hint"
      // Phones: the info panels' offset above the compact ControlPanel. Wider
      // screens: above the expanded desktop ControlPanel at its largest
      // `mm-ui-scale` zoom (its top sits ~208 px up at 1280×720).
      className="absolute z-[15] mm-fade left-3 right-3 bottom-[calc(env(safe-area-inset-bottom,0px)+168px)]
                 sm:left-1/2 sm:right-auto sm:bottom-56 sm:w-[min(520px,calc(100vw-32px))] sm:-translate-x-1/2"
    >
      <div className="bg-(--mm-panel)/95 backdrop-blur-md border border-(--mm-border) rounded-sm
                      shadow-2xl shadow-(color:--mm-shadow) p-3 flex gap-3">
        <img
          src="/pwa/icon-192.png"
          alt=""
          width={48}
          height={48}
          draggable={false}
          className="w-12 h-12 rounded-sm shrink-0 select-none"
        />
        <div className="min-w-0 flex-1">
          <div id="pwa-install-title" className="mm-mono text-[10px] tracking-[0.25em] text-(--mm-amber-1)">
            {t.installAppTitle.toUpperCase()}
          </div>
          <p id="pwa-install-hint" className="mt-1 text-[12px] leading-snug text-(--mm-fg)/80">
            {hint}
          </p>
          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={later}
              className="h-9 px-3 mm-mono text-[11px] tracking-wider text-(--mm-text-secondary) hover:text-(--mm-fg) active:bg-(--mm-fg)/10 rounded-sm transition-colors"
            >
              {t.installAppLater.toUpperCase()}
            </button>
            <button
              type="button"
              onClick={() => { void installOrDismiss() }}
              className="h-9 px-4 mm-mono text-[11px] tracking-[0.2em] font-bold text-(--mm-on-accent) bg-(--mm-amber) active:bg-(--mm-amber-2) rounded-sm"
              style={{ boxShadow: '0 0 20px color-mix(in srgb, var(--mm-amber) 30%, transparent)' }}
            >
              {(canInstallDirectly ? t.installAppNow : t.installAppDismiss).toUpperCase()}
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
