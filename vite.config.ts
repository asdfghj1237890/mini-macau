import { defineConfig, type PluginOption, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev-time /api/dsat/batch that mirrors what the OpenResty prod config
// does with ngx.location.capture_multi: fan out to per-route DSAT calls
// in parallel and merge into one JSON array.
const dsatBatchDevPlugin = (): PluginOption => ({
  name: 'dsat-batch-dev',
  configureServer(server: ViteDevServer) {
    server.middlewares.use('/api/dsat/batch', async (req, res) => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost')
        const routesStr = url.searchParams.get('routes') ?? ''
        if (!routesStr) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end('{"error":"missing routes param"}')
          return
        }
        const pairs = routesStr.split(',').flatMap(p => {
          const m = p.match(/^([\w\-.]+):([01])$/)
          return m ? [{ key: `${m[1]}:${m[2]}`, name: m[1], dir: m[2] }] : []
        })
        const results = await Promise.all(pairs.map(async ({ key, name, dir }) => {
          try {
            const upstream = `https://bis.dsat.gov.mo/macauweb/routestation/bus?routeName=${encodeURIComponent(name)}&dir=${dir}`
            const r = await fetch(upstream, {
              headers: { Referer: 'https://bis.dsat.gov.mo/macauweb/' },
            })
            let data: unknown = null
            if (r.ok) {
              try { data = await r.json() } catch { data = null }
            }
            return { key, status: r.status, data }
          } catch {
            return { key, status: 502, data: null }
          }
        }))
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.end(JSON.stringify(results))
      } catch (e) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), dsatBatchDevPlugin()],
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
