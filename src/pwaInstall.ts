// Add-to-home-screen support: which browser the page runs in (the install
// hint's wording depends on it), whether the page already runs as an
// installed app, the install card's dismissal memory, and the one
// `beforeinstallprompt` event Chromium hands a page — shared between the
// card and the Map Settings drawer because the browser supplies it once.
//
// Nothing here touches `window` at module level: every browser object is a
// parameter or is bound lazily inside `beginInstallTracking`, so the module
// loads in node for the tests.

export type InstallPlatform =
  | 'ios-safari'
  | 'ios-chrome'
  | 'ios-edge'
  | 'android-chrome'
  | 'android-edge'
  | 'android-firefox'
  | 'android-opera'
  | 'android-samsung'
  | 'android-huawei'
  | 'android-xiaomi'
  | 'android-oppo'
  | 'android-vivo'
  | 'android-honor'

export const INSTALL_PLATFORMS: readonly InstallPlatform[] = [
  'ios-safari',
  'ios-chrome',
  'ios-edge',
  'android-chrome',
  'android-edge',
  'android-firefox',
  'android-opera',
  'android-samsung',
  'android-huawei',
  'android-xiaomi',
  'android-oppo',
  'android-vivo',
  'android-honor',
]

/**
 * What the card explains. Android browsers that hand us their install event
 * all get the same "tap INSTALL" sentence; Chrome on Android without the
 * event describes its menu route like the vendor browsers do.
 */
export type InstallHintKey = Exclude<InstallPlatform, 'android-chrome'> | 'android-install' | 'android-chrome-menu'

type NavigatorLike = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function detectInstallPlatform(nav: NavigatorLike): InstallPlatform | undefined {
  const ua = nav.userAgent
  // iPadOS Safari asks for desktop sites by default and calls itself a Mac;
  // the touch points give it away.
  const isIos = /iPad|iPhone|iPod/i.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)

  if (isIos && /CriOS/i.test(ua)) return 'ios-chrome'
  if (isIos && /EdgiOS/i.test(ua)) return 'ios-edge'

  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Edg/i.test(ua)
  if (isIos && isSafari) return 'ios-safari'

  if (!/Android/i.test(ua)) return undefined
  // Most Android vendor browsers also carry a Chrome token. Their own tokens
  // come first so the card can name the right menu when they do not dispatch
  // Chromium's `beforeinstallprompt`.
  if (/HuaweiBrowser/i.test(ua)) return 'android-huawei'
  if (/MiuiBrowser/i.test(ua)) return 'android-xiaomi'
  if (/HeyTapBrowser/i.test(ua)) return 'android-oppo'
  if (/VivoBrowser/i.test(ua)) return 'android-vivo'
  if (/HonorBrowser/i.test(ua)) return 'android-honor'
  if (/EdgA/i.test(ua)) return 'android-edge'
  if (/Firefox|Fennec/i.test(ua)) return 'android-firefox'
  if (/OPR|Opera/i.test(ua)) return 'android-opera'
  if (/SamsungBrowser/i.test(ua)) return 'android-samsung'

  const isAndroidChrome = /Chrome/i.test(ua) && !/DuckDuckGo/i.test(ua)
  return isAndroidChrome ? 'android-chrome' : undefined
}

export function isAndroidPlatform(platform: InstallPlatform | null | undefined): boolean {
  return platform?.startsWith('android-') ?? false
}

/**
 * Browsers with no install event of their own: the card can only explain the
 * browser's Share / menu route, so it shows a little after load on its own.
 * Chrome on Android waits for `beforeinstallprompt` instead.
 */
export function needsManualGuide(platform: InstallPlatform): boolean {
  return platform !== 'android-chrome'
}

export function installHintKey(platform: InstallPlatform, hasInstallEvent: boolean): InstallHintKey {
  if (platform === 'android-chrome') return hasInstallEvent ? 'android-install' : 'android-chrome-menu'
  return isAndroidPlatform(platform) && hasInstallEvent ? 'android-install' : platform
}

/** `navigator.standalone` is iOS Safari's flag; `display-mode` is everyone else's. */
export function isStandaloneApp(navigatorStandalone: boolean | undefined, displayModeStandalone: boolean): boolean {
  return navigatorStandalone === true || displayModeStandalone
}

/**
 * `?install=<platform>` previews that platform's card on any device, ignoring
 * the dismissal memory and the installed state — for checking the wording of
 * all thirteen variants without owning thirteen phones.
 */
export function previewInstallPlatform(search: string): InstallPlatform | null {
  let value: string | null
  try {
    value = new URLSearchParams(search).get('install')
  } catch {
    return null
  }
  return value && (INSTALL_PLATFORMS as readonly string[]).includes(value) ? (value as InstallPlatform) : null
}

// ---- dismissal memory --------------------------------------------------

const DISMISS_PREFIX = 'mini-macau-pwa-install-dismissed-'

function dismissalKey(platform: InstallPlatform): string {
  return `${DISMISS_PREFIX}${platform}`
}

export function isInstallDismissed(platform: InstallPlatform, storage: StorageLike, now = Date.now()): boolean {
  try {
    const until = Number(storage.getItem(dismissalKey(platform)))
    return Number.isFinite(until) && until > now
  } catch {
    return false
  }
}

export function dismissInstall(platform: InstallPlatform, storage: StorageLike, days: number, now = Date.now()): void {
  try {
    storage.setItem(dismissalKey(platform), String(now + days * 24 * 60 * 60 * 1000))
  } catch {
    // Private browsing or a full quota must not break the app.
  }
}

// ---- the shared install event -----------------------------------------

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export interface InstallState {
  /** Chromium's `beforeinstallprompt`, held until `requestInstall` spends it. */
  readonly installEvent: BeforeInstallPromptEvent | null
  /** Running as an installed app, or `appinstalled` fired on this page. */
  readonly installed: boolean
  /** Bumped by `showInstallGuide`; the card opens for the detected platform whenever it changes. */
  readonly guideRequest: number
}

export interface InstallWindowLike {
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
  /** `standalone` is iOS Safari's own flag; `userAgent` is here so a real `Navigator` overlaps this shape. */
  navigator?: { userAgent?: string; standalone?: boolean }
  matchMedia?: (query: string) => { matches: boolean }
}

let state: InstallState = { installEvent: null, installed: false, guideRequest: 0 }
const listeners = new Set<() => void>()
let consumers = 0
let tracked: InstallWindowLike | undefined

function setState(patch: Partial<InstallState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function getInstallState(): InstallState {
  return state
}

export function subscribeInstallState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function onBeforeInstallPrompt(event: Event): void {
  // Keep Chromium's own mini-infobar away; the card asks in the app's words.
  event.preventDefault()
  setState({ installEvent: event as BeforeInstallPromptEvent })
}

function onAppInstalled(): void {
  setState({ installed: true, installEvent: null })
}

export function detectInstalled(target: InstallWindowLike): boolean {
  return isStandaloneApp(
    target.navigator?.standalone,
    target.matchMedia?.('(display-mode: standalone)').matches ?? false,
  )
}

/**
 * Listen for the browser's install event once for the whole app — Chromium
 * fires it a single time, so the card and the drawer must share it rather
 * than race for separate copies. Returns a disposer; the listeners go when
 * the last consumer has left.
 */
export function beginInstallTracking(target: InstallWindowLike = window): () => void {
  if (consumers === 0) {
    tracked = target
    const installed = detectInstalled(target)
    setState({ installed, installEvent: null })
    if (!installed) {
      target.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      target.addEventListener('appinstalled', onAppInstalled)
    }
  }
  consumers += 1

  let active = true
  return () => {
    if (!active) return
    active = false
    consumers -= 1
    if (consumers > 0) return
    tracked?.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    tracked?.removeEventListener('appinstalled', onAppInstalled)
    tracked = undefined
    setState({ installEvent: null, installed: false })
  }
}

/**
 * Show the browser's own install dialog. Resolves to the user's choice, or
 * undefined when there is no event to spend. The event is single-use —
 * Chromium refuses a second `prompt()` even after a dismissal — so it is
 * dropped either way.
 */
export async function requestInstall(): Promise<'accepted' | 'dismissed' | undefined> {
  const event = state.installEvent
  if (!event) return undefined
  try {
    await event.prompt()
    return (await event.userChoice).outcome
  } finally {
    setState({ installEvent: null })
  }
}

/** Open the card for the detected platform regardless of the dismissal memory (the drawer's APP row). */
export function showInstallGuide(): void {
  setState({ guideRequest: state.guideRequest + 1 })
}
