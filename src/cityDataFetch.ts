import type { TransitData, RoadWorkNotice, School, SchoolLevel, PublicHousingEstate, PublicHousingType, Parish, Toilet, CarPark, WasteSite, WasteSource, WasteFacility, WasteEcoStation, DspaStats, WaterFacility, WaterNetwork, WaterFacts, PowerFacility, PowerNetwork, PowerFacts, GrandPrixFile } from './types'
import type { CityDataset } from './cityData'
import type { z } from 'zod'

import {
  RoadWorksFileSchema,
  SchoolsFileSchema,
  PublicHousingFileSchema,
  ParishesFileSchema,
  ToiletsFileSchema,
  CarParksFileSchema,
  WasteFileSchema,
  DspaStatsFileSchema,
  WaterFacilitiesFileSchema,
  PowerFacilitiesFileSchema,
  GrandPrixFileSchema,
} from './dataSchemas'

// road-works.json wraps the notices in a metadata envelope; only `notices`
// reaches TransitData (the runtime never reads the provenance fields — the
// panel's source attribution is a static label).
interface RoadWorksFile {
  fetchedAtUtc: string
  exportedAt: string
  source: { name: string; dataset: string; download: string }
  notices: RoadWorkNotice[]
}

// schools.json likewise wraps the list in a metadata envelope. Only `schools`
// reaches TransitData — `unmatchedDsedj` / `droppedOsm` are pipeline
// diagnostics and the source attribution in the sidebar is a static label.
interface SchoolsFile {
  fetchedAtUtc: string
  sources: Record<string, string>
  levels: SchoolLevel[]
  schools: School[]
}

// public-housing.json: the same envelope. Only `estates` reaches TransitData;
// `unmatched` is a pipeline diagnostic.
interface PublicHousingFile {
  fetchedAtUtc: string
  sources: Record<string, string>
  types: PublicHousingType[]
  estates: PublicHousingEstate[]
}

// parishes.json: the same envelope; only `parishes` reaches TransitData.
interface ParishesFile {
  fetchedAtUtc: string
  sources: Record<string, string>
  parishes: Parish[]
}

// toilets.json is the same envelope pattern again: only `toilets` reaches
// TransitData. `updatedAt` (the upstream readme's timestamp) and `sources`
// stay provenance metadata — the panel and the sidebar carry static labels.
interface ToiletsFile {
  fetchedAtUtc: string
  updatedAt: string | null
  sources: Record<string, string>
  toilets: Toilet[]
}

// car-parks.json — the static half of the car-park overlay. The live vacancy
// numbers are NOT here: the browser polls the DSAT gateway for those
// (useCarParkVacancy), so nothing time-sensitive rides on this file.
interface CarParksFile {
  fetchedAtUtc: string
  sources: Record<string, string>
  carParks: CarPark[]
}

// waste.json — the six kinds of collection point. Unlike its neighbours BOTH
// halves reach TransitData: the info panel names the dataset a site came from
// and shows its upstream timestamp, so `sources` is not just metadata here.
interface WasteFile {
  fetchedAtUtc: string
  sources: WasteSource[]
  sites: WasteSite[]
  // Added after the file shipped, so all three are optional here and in the zod
  // schema: an older waste.json simply draws no facilities, no eco stations and
  // no throughput stats rather than failing validation.
  facilities?: WasteFacility[]
  ecoStations?: WasteEcoStation[]
}

// water-facilities.json — Macao Water's 22 supply facilities, same envelope
// pattern again: `facilities`, `facts` and the optional `network` reach
// TransitData, `sources` stays provenance metadata (the panel and sidebar
// carry static labels).
interface WaterFacilitiesFile {
  fetchedAtUtc: string
  sources: Record<string, string>
  facts: WaterFacts
  facilities: WaterFacility[]
  // The schematic pipe network was added after the facility list shipped, so
  // it is optional here and in the zod schema: an older file simply draws no
  // pipes rather than failing validation.
  network?: WaterNetwork
}

// power-facilities.json — CEM's generation and HV substations, same envelope
// pattern again: `facilities`, `facts` and the optional `network` reach
// TransitData, `sources` stays provenance metadata (the panel and the sidebar
// carry static labels).
interface PowerFacilitiesFile {
  fetchedAtUtc: string
  sources: Record<string, string>
  facts: PowerFacts
  facilities: PowerFacility[]
  // Optional like the water file's: a file with no HV edge list simply draws no
  // lines rather than failing validation.
  network?: PowerNetwork
}

async function read<T>(name: string, schema: z.ZodType): Promise<T> {
  const response = await fetch(`/data/${name}.json`)
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  const raw = await response.json()
  // Reject malformed overlays in production too so they remain retryable.
  schema.parse(raw)
  return raw as T
}

export async function loadCityDataset(id: CityDataset): Promise<Partial<TransitData>> {
  switch (id) {
    case 'works': return { roadWorks: (await read<RoadWorksFile>('road-works', RoadWorksFileSchema)).notices }
    case 'schools': return { schools: (await read<SchoolsFile>('schools', SchoolsFileSchema)).schools }
    case 'housing': return { publicHousing: (await read<PublicHousingFile>('public-housing', PublicHousingFileSchema)).estates }
    case 'parishes': return { parishes: (await read<ParishesFile>('parishes', ParishesFileSchema)).parishes }
    case 'toilets': return { toilets: (await read<ToiletsFile>('toilets', ToiletsFileSchema)).toilets }
    case 'carparks': return { carParks: (await read<CarParksFile>('car-parks', CarParksFileSchema)).carParks }
    case 'waste': {
      const file = await read<WasteFile>('waste', WasteFileSchema)
      return { waste: file.sites, wasteSources: file.sources ?? [], wasteFacilities: file.facilities ?? [], wasteEcoStations: file.ecoStations ?? [] }
    }
    case 'stats': return { dspaStats: await read<DspaStats>('dspa-stats', DspaStatsFileSchema) }
    case 'water': {
      const file = await read<WaterFacilitiesFile>('water-facilities', WaterFacilitiesFileSchema)
      return { waterFacilities: file.facilities, waterNetwork: file.network ?? null, waterFacts: file.facts }
    }
    case 'power': {
      const file = await read<PowerFacilitiesFile>('power-facilities', PowerFacilitiesFileSchema)
      return { powerFacilities: file.facilities, powerNetwork: file.network ?? null, powerFacts: file.facts }
    }
    case 'grandprix': {
      const file = await read<GrandPrixFile>('grand-prix', GrandPrixFileSchema)
      return { grandPrix: file.circuit, grandPrixSources: file.sources ?? [] }
    }
  }
}
