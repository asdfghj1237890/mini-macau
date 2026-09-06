import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { seoContentPlugin } from './plugins/seo-content'
import { lrtDevApiPlugin } from './plugins/lrt-dev-api'

export default defineConfig({
  plugins: [react(), tailwindcss(), seoContentPlugin(), lrtDevApiPlugin()],
  server: {
    // /api/* is a Cloudflare Pages Function in production (functions/). In
    // dev, lrtDevApiPlugin serves /api/lrt/* from a local git-ignored copy of
    // the timetable when there is one; otherwise the request falls through to
    // this proxy and production answers. The Function only accepts requests
    // that look like they come from the site, hence the Referer.
    proxy: {
      '/api': {
        target: 'https://mini-map-macau.app',
        changeOrigin: true,
        headers: { Origin: 'https://mini-map-macau.app', Referer: 'https://mini-map-macau.app/' },
      },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules\/react/ },
            { name: 'vendor-maplibre', test: /node_modules\/maplibre-gl/ },
          ],
        },
      },
    },
  },
})
