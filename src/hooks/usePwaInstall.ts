import { useSyncExternalStore } from 'react'
import { getInstallState, subscribeInstallState, type InstallState } from '../pwaInstall'

/**
 * The shared add-to-home-screen state (see `pwaInstall.ts`): the browser's
 * pending install event, whether the page already runs installed, and the
 * drawer's request to open the card. The snapshot object is replaced on
 * every change, so destructuring it is safe. Someone must have called
 * `beginInstallTracking` for the event to ever arrive.
 */
export function usePwaInstall(): InstallState {
  return useSyncExternalStore(subscribeInstallState, getInstallState, getInstallState)
}
