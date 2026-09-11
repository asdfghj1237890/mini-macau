import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './fontSize'
import App from './App'
import { I18nProvider } from './i18n'
import { installDebugOverlay } from './debugOverlay'

// `?debug=1`: an on-screen error and capability log for phones (a no-op
// otherwise). Installed before React so a failing first render is caught too.
installDebugOverlay()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)

// A registered worker with a fetch handler is what makes Chromium fire
// `beforeinstallprompt` — the one-tap INSTALL in the add-to-home-screen
// card. `public/sw.js` caches nothing (the note there says why). Production
// only: a worker registered against the dev server would outlive its
// restarts.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Without a worker the card still explains the manual route.
    })
  })
}
