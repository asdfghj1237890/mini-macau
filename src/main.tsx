import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
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
