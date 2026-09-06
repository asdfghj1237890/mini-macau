import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

// Dev-only stand-in for the Pages Function at /api/lrt/<scheduleType>
// (functions/api/lrt/[stype].ts). The LRT timetable is not in the repo, so
// `npm run dev` has two ways to get it:
//
//   1. a local, git-ignored copy at src/data/trips-<scheduleType>.json — the
//      maintainer's checkout of the private data repo. Served from disk here.
//   2. none on disk — this middleware steps aside and Vite's `/api` proxy
//      (vite.config.ts) forwards the request to the production Function.
//
// Never active in a build (`apply: 'serve'`), so nothing here can put the
// timetable into dist/.
const ROUTE = /^\/api\/lrt\/(mon_thu|friday|sat_sun)$/

export function lrtDevApiPlugin(): Plugin {
  return {
    name: 'lrt-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        const m = ROUTE.exec(path)
        if (!m) return next()
        const file = resolve(server.config.root, 'src', 'data', `trips-${m[1]}.json`)
        if (!existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(readFileSync(file))
      })
    },
  }
}
