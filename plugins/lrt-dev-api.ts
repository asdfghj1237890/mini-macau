import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import type { TransitData } from '../src/types'
import type { LrtStateWindow } from '../src/lrtState'
import { serveLrt } from '../server/lrt-api'

// Local inputs stay in the server module graph. Missing inputs use the API proxy.
export function lrtDevApiPlugin(): Plugin {
  return {
    name: 'lrt-dev-api', apply: 'serve',
    configureServer(server) {
      let provider: Promise<(start: number) => LrtStateWindow> | undefined
      server.watcher.on('change', path => {
        const normalized = path.replaceAll('\\', '/')
        if (/\/server\/lrt-/.test(normalized) || /\/src\/(?:engines\/lrt|lrtTracks|macauTime)/.test(normalized)
          || /\/(?:trips-[^/]+|lrt-lines|stations)\.json$/.test(normalized)) provider = undefined
      })
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
        const match = /^\/api\/lrt\/([^/]+)\/?$/.exec(url.pathname)
        if (!match) return next()
        const paths = ['mon_thu', 'friday', 'sat_sun'].map(type => resolve(server.config.root, `src/data/trips-${type}.json`))
        if (match[1] === 'state' && !paths.every(existsSync)) return next()
        try {
          if (match[1] === 'state') provider ??= server.ssrLoadModule('/server/lrt-window.ts').then(module => {
            const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
            const data: Pick<TransitData, 'lrtLines' | 'stations' | 'trips'> = {
              lrtLines: read(resolve(server.config.root, 'public/data/lrt-lines.json')),
              stations: read(resolve(server.config.root, 'public/data/stations.json')),
              trips: paths.flatMap(read),
            }
            return module.createLrtWindowProvider(data)
          })
          const headers = new Headers()
          for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value)
          const response = serveLrt(new Request(url, { method: req.method, headers }), match[1],
            provider ? await provider : () => { throw new Error('Unavailable') })
          res.statusCode = response.status
          response.headers.forEach((value, name) => res.setHeader(name, value))
          res.end(await response.text())
        } catch {
          provider = undefined
          res.statusCode = 503
          res.setHeader('Cache-Control', 'no-store')
          res.end('LRT state unavailable')
        }
      })
    },
  }
}

export function assertLrtBrowserModule(id: string) {
  const path = id.replaceAll('\\', '/')
  if (/\/server\/lrt-/.test(path) || /\/functions\/_lrt\//.test(path) || /\/trips-[^/]+\.json/.test(path)) {
    throw new Error('Server-only LRT input or computation entered the browser module graph')
  }
}

export function lrtBrowserBoundaryPlugin(): Plugin {
  return {
    name: 'lrt-browser-boundary', apply: 'build',
    generateBundle() { for (const id of this.getModuleIds()) assertLrtBrowserModule(id) },
  }
}
