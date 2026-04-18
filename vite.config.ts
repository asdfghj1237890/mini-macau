import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/dsat': {
        target: 'https://bis.dsat.gov.mo',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/dsat/, '/macauweb'),
        headers: {
          Referer: 'https://bis.dsat.gov.mo/macauweb/',
        },
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
