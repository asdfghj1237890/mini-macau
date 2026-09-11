import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import type { CityCatalog } from '../src/cityCatalog'

const files = [
  'parishes', 'road-works', 'car-parks', 'toilets', 'schools',
  'public-housing', 'water-facilities', 'power-facilities', 'waste', 'grand-prix',
] as const

// This runs in Node at build time. Only counts and aggregated notice date
// windows enter the virtual module; full facility files stay separate assets.
export async function buildCityCatalog(directory: string): Promise<CityCatalog> {
  const [parishes, works, parking, toilets, schools, housing, water, power, waste, gp] =
    await Promise.all(files.map(async file => JSON.parse(await readFile(resolve(directory, `${file}.json`), 'utf8'))))
  function countBy<K extends string>(items: Record<string, string>[], field: string, keys: K[]): Record<K, number> {
    const counts = Object.fromEntries(keys.map(key => [key, 0])) as Record<K, number>
    for (const item of items) if (Object.hasOwn(counts, item[field])) counts[item[field] as K]++
    return counts
  }
  const wasteTypes = countBy(waste.sites, 'type', [
    'refuse_room', 'compactor', 'refuse_station', 'smart_machine', 'three_colour',
    'e_waste', 'lamp_battery', 'glass', 'clothing', 'eco_station', 'facility', 'wwtp',
  ])
  wasteTypes.eco_station = waste.ecoStations?.length ?? 0
  wasteTypes.wwtp = (waste.facilities ?? []).filter((f: { kind: string }) => f.kind === 'wwtp').length
  wasteTypes.facility = (waste.facilities?.length ?? 0) - wasteTypes.wwtp +
    (power.facilities.some((f: { id: string; type: string }) => f.id === 'incinerator' && f.type === 'incinerator') ? 1 : 0)
  const windows = new Map<string, [string, string, number]>()
  for (const notice of works.notices) {
    const key = `${notice.startDate}/${notice.endDate}`
    const entry = windows.get(key) ?? [notice.startDate, notice.endDate, 0]
    entry[2]++
    windows.set(key, entry)
  }
  return {
    counts: {
      parishes: parishes.parishes.length, works: works.notices.length,
      carparks: parking.carParks.length, toilets: toilets.toilets.length,
      schools: schools.schools.length, housing: housing.estates.length,
      water: water.facilities.length, power: power.facilities.length,
      waste: Object.values(wasteTypes).reduce((a, b) => a + b, 0), grandprix: gp.circuit.corners.length,
    },
    schoolLevels: countBy(schools.schools, 'level', ['kindergarten', 'primary', 'secondary', 'university', 'all_through']),
    housingTypes: countBy(housing.estates, 'type', ['social', 'economic', 'other']),
    wasteTypes,
    roadWorkWindows: [...windows.values()],
  }
}

export function cityCatalogPlugin(): Plugin {
  const id = '\0virtual:city-catalog'
  let directory: string
  return {
    name: 'city-catalog',
    configResolved(config) { directory = config.publicDir },
    resolveId(source) { if (source === 'virtual:city-catalog') return id },
    async load(source) {
      if (source !== id) return
      const dataDir = resolve(directory, 'data')
      for (const file of files) this.addWatchFile(resolve(dataDir, `${file}.json`))
      return `export default ${JSON.stringify(await buildCityCatalog(dataDir))}`
    },
    handleHotUpdate({ file, server }) {
      if (!files.some(name => file === resolve(directory, 'data', `${name}.json`).replaceAll('\\', '/'))) return
      const mod = server.moduleGraph.getModuleById(id)
      if (mod) return [mod]
    },
  }
}
