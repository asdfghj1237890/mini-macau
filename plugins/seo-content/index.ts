// Injects crawlable transit lists into index.html at build/dev time.
// Data bots already trigger a rebuild+deploy on every data commit
// (.github/workflows/deploy.yml), so the injected lists can never drift
// from public/data/*.json. Validation failures throw: a malformed data
// file must fail the build, not silently ship an empty list.
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import type { z } from 'zod'
import {
  BusRoutesSchema,
  LRTLinesSchema,
  StationsSchema,
  FerryScheduleFileSchema,
} from '../../src/dataSchemas'
import { renderTransitLists } from './render'

export const SEO_PLACEHOLDER = '<!-- SEO:TRANSIT_LISTS -->'

// Not src/dataSchemas.parseData: its failure path reads import.meta.env.DEV,
// which is undefined when this runs under node (vite.config context).
function parseOrThrow<S extends z.ZodType>(schema: S, raw: unknown, label: string): z.infer<S> {
  const res = schema.safeParse(raw)
  if (!res.success) {
    const summary = res.error.issues
      .slice(0, 5)
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join(' | ')
    throw new Error(`[seo-content] ${label} failed schema validation: ${summary}`)
  }
  return res.data
}

function loadJson(root: string, rel: string): unknown {
  const text = fs.readFileSync(path.resolve(root, rel), 'utf8')
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`[seo-content] ${rel} is not valid JSON: ${(e as Error).message}`)
  }
}

export function seoContentPlugin(): Plugin {
  let root = process.cwd()
  return {
    name: 'seo-content',
    configResolved(config) {
      root = config.root
    },
    transformIndexHtml(html) {
      if (!html.includes(SEO_PLACEHOLDER)) {
        throw new Error(`[seo-content] placeholder ${SEO_PLACEHOLDER} not found in index.html`)
      }
      const busRoutes = parseOrThrow(BusRoutesSchema, loadJson(root, 'public/data/bus-routes.json'), 'bus-routes.json')
      const stations = parseOrThrow(StationsSchema, loadJson(root, 'public/data/stations.json'), 'stations.json')
      const lrtLines = parseOrThrow(LRTLinesSchema, loadJson(root, 'public/data/lrt-lines.json'), 'lrt-lines.json')
      const ferry = parseOrThrow(FerryScheduleFileSchema, loadJson(root, 'public/data/ferry-schedules.json'), 'ferry-schedules.json')
      return html.replace(
        SEO_PLACEHOLDER,
        () => renderTransitLists({ busRoutes, stations, lrtLines, ferryRoutes: ferry.routes }),
      )
    },
  }
}
