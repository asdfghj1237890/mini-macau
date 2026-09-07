import { describe, expect, it } from 'vitest'
import {
  INSTALL_PLATFORMS,
  beginInstallTracking,
  detectInstallPlatform,
  dismissInstall,
  getInstallState,
  installHintKey,
  isAndroidPlatform,
  isInstallDismissed,
  isStandaloneApp,
  needsManualGuide,
  previewInstallPlatform,
  requestInstall,
  showInstallGuide,
  subscribeInstallState,
  type BeforeInstallPromptEvent,
} from './pwaInstall'

const IOS_WEBKIT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.113 Mobile Safari/537.36'
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

function nav(userAgent: string, platform = 'iPhone', maxTouchPoints = 5) {
  return { userAgent, platform, maxTouchPoints }
}

describe('detectInstallPlatform', () => {
  it('recognises Safari, Chrome and Edge on iOS, including iPad desktop mode', () => {
    expect(detectInstallPlatform(nav(`${IOS_WEBKIT} Version/17.5 Mobile/15E148 Safari/604.1`))).toBe('ios-safari')
    expect(detectInstallPlatform(nav(`${IOS_WEBKIT} CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1`))).toBe('ios-chrome')
    expect(detectInstallPlatform(nav(`${IOS_WEBKIT} EdgiOS/125.0.2535.72 Version/17.0 Mobile/15E148 Safari/604.1`))).toBe('ios-edge')
    expect(detectInstallPlatform(nav(`${IOS_WEBKIT} FxiOS/126.0 Mobile/15E148 Safari/605.1.15`))).toBeUndefined()
    expect(detectInstallPlatform(nav(IPAD_DESKTOP, 'MacIntel', 5))).toBe('ios-safari')
    expect(detectInstallPlatform(nav(IPAD_DESKTOP, 'MacIntel', 0))).toBeUndefined()
  })

  it('recognises the supported Android browser families', () => {
    expect(detectInstallPlatform(nav(ANDROID_CHROME, 'Linux armv8l'))).toBe('android-chrome')
    expect(detectInstallPlatform(nav(`${ANDROID_CHROME} EdgA/125.0.2535.72`, 'Linux armv8l'))).toBe('android-edge')
    expect(detectInstallPlatform(nav('Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0', 'Linux armv8l'))).toBe('android-firefox')
    expect(detectInstallPlatform(nav(`${ANDROID_CHROME} OPR/82.3.4342`, 'Linux armv8l'))).toBe('android-opera')
    expect(detectInstallPlatform(nav('Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36', 'Linux armv8l'))).toBe('android-samsung')
    expect(detectInstallPlatform(nav(`${ANDROID_CHROME} DuckDuckGo/5`, 'Linux armv8l'))).toBeUndefined()
  })

  it('recognises Android vendor browsers before their shared Chrome token', () => {
    const vendors: Array<[string, string]> = [
      ['HuaweiBrowser/14.0.4.300', 'android-huawei'],
      ['MiuiBrowser/18.0.4', 'android-xiaomi'],
      ['HeyTapBrowser/45.10.1.1', 'android-oppo'],
      ['VivoBrowser/17.1.7.0', 'android-vivo'],
      ['HONORBrowser/6.0.1', 'android-honor'],
    ]
    for (const [token, platform] of vendors) {
      expect(detectInstallPlatform(nav(`${ANDROID_CHROME} ${token}`, 'Linux armv8l'))).toBe(platform)
    }
  })

  it('leaves desktop browsers alone', () => {
    expect(detectInstallPlatform(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', 'Win32', 0))).toBeUndefined()
    expect(detectInstallPlatform(nav(IPAD_DESKTOP, 'MacIntel', 0))).toBeUndefined()
  })
})

describe('install hint selection', () => {
  it('sends every platform but Chrome on Android down the manual route', () => {
    for (const platform of INSTALL_PLATFORMS) {
      expect(needsManualGuide(platform)).toBe(platform !== 'android-chrome')
    }
    expect(isAndroidPlatform('android-samsung')).toBe(true)
    expect(isAndroidPlatform('ios-safari')).toBe(false)
    expect(isAndroidPlatform(null)).toBe(false)
  })

  it('picks the tap-INSTALL sentence for any Android browser holding the install event', () => {
    expect(installHintKey('android-chrome', true)).toBe('android-install')
    expect(installHintKey('android-samsung', true)).toBe('android-install')
    expect(installHintKey('android-chrome', false)).toBe('android-chrome-menu')
    expect(installHintKey('android-samsung', false)).toBe('android-samsung')
    expect(installHintKey('ios-safari', false)).toBe('ios-safari')
    expect(installHintKey('ios-safari', true)).toBe('ios-safari')
  })

  it('reads the ?install= preview switch and ignores anything else', () => {
    expect(previewInstallPlatform('?install=ios-safari')).toBe('ios-safari')
    expect(previewInstallPlatform('?debug=1&install=android-honor')).toBe('android-honor')
    expect(previewInstallPlatform('?install=windows')).toBeNull()
    expect(previewInstallPlatform('')).toBeNull()
  })
})

describe('dismissal memory', () => {
  it('remembers a dismissal until its expiry and tolerates blocked storage', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    }
    const now = 1_700_000_000_000
    expect(isInstallDismissed('ios-safari', storage, now)).toBe(false)
    dismissInstall('ios-safari', storage, 30, now)
    expect(isInstallDismissed('ios-safari', storage, now + 29 * 86_400_000)).toBe(true)
    expect(isInstallDismissed('ios-safari', storage, now + 31 * 86_400_000)).toBe(false)
    // Each browser keeps its own memory.
    expect(isInstallDismissed('ios-chrome', storage, now)).toBe(false)
    expect([...store.keys()]).toEqual(['mini-macau-pwa-install-dismissed-ios-safari'])

    const blocked = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('QuotaExceededError') },
    }
    expect(() => dismissInstall('android-chrome', blocked, 1, now)).not.toThrow()
    expect(isInstallDismissed('android-chrome', blocked, now)).toBe(false)
  })

  it('does not prompt when already running as an installed app', () => {
    expect(isStandaloneApp(true, false)).toBe(true)
    expect(isStandaloneApp(undefined, true)).toBe(true)
    expect(isStandaloneApp(false, false)).toBe(false)
    expect(isStandaloneApp(undefined, false)).toBe(false)
  })
})

class FakeWindow extends EventTarget {
  readonly standalone: boolean

  constructor(standalone = false) {
    super()
    this.standalone = standalone
  }

  matchMedia = () => ({ matches: this.standalone })
}

function fakeInstallEvent(outcome: 'accepted' | 'dismissed'): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent
  event.prompt = () => Promise.resolve()
  event.userChoice = Promise.resolve({ outcome, platform: 'web' })
  return event
}

describe('the shared install event', () => {
  it('shares the one browser install event between consumers and spends it once', async () => {
    const target = new FakeWindow()
    let notifications = 0
    const unsubscribe = subscribeInstallState(() => { notifications += 1 })
    const stopCard = beginInstallTracking(target)
    const stopDrawer = beginInstallTracking(target)
    expect(getInstallState().installed).toBe(false)

    const event = fakeInstallEvent('accepted')
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(getInstallState().installEvent).toBe(event)

    await expect(requestInstall()).resolves.toBe('accepted')
    expect(getInstallState().installEvent).toBeNull()
    await expect(requestInstall()).resolves.toBeUndefined()

    showInstallGuide()
    expect(getInstallState().guideRequest).toBe(1)
    expect(notifications).toBeGreaterThan(0)

    target.dispatchEvent(new Event('appinstalled'))
    expect(getInstallState().installed).toBe(true)

    // The listeners stay while any consumer is left and go with the last one;
    // a disposer called twice is one departure.
    stopCard()
    stopCard()
    expect(getInstallState().installed).toBe(true)
    stopDrawer()
    expect(getInstallState().installed).toBe(false)
    target.dispatchEvent(fakeInstallEvent('dismissed'))
    expect(getInstallState().installEvent).toBeNull()
    unsubscribe()
  })

  it('reports standalone mode as already installed and collects no event', () => {
    const target = new FakeWindow(true)
    const stop = beginInstallTracking(target)
    expect(getInstallState().installed).toBe(true)
    target.dispatchEvent(fakeInstallEvent('accepted'))
    expect(getInstallState().installEvent).toBeNull()
    stop()
  })
})
