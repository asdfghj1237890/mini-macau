import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { seoContentPlugin } from './plugins/seo-content'

export default defineConfig({
  plugins: [react(), tailwindcss(), seoContentPlugin()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules\/react/ },
            { name: 'vendor-maplibre', test: /node_modules\/maplibre-gl/ },
          ],
        },
        // The LRT timetable chunks (src/data/trips-*.json, lazily imported by
        // useTransitData) get a bare content hash instead of the default
        // `[name]-[hash]`, so the built URL says nothing about what it is.
        // Obfuscation only — the chunk is still fetchable once found in the
        // bundle graph.
        chunkFileNames: (chunk) =>
          /^trips-/.test(chunk.name) || /[\\/]src[\\/]data[\\/]trips-/.test(chunk.facadeModuleId ?? '')
            ? 'assets/[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
})
