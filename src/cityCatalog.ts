import type { PublicHousingType, SchoolLevel, WasteSiteType } from './types'
import type { CityLayer } from './cityData'

export interface CityCatalog {
  counts: Record<CityLayer, number>
  schoolLevels: Record<SchoolLevel, number>
  housingTypes: Record<PublicHousingType, number>
  wasteTypes: Record<WasteSiteType | 'eco_station' | 'facility' | 'wwtp', number>
  // Aggregated start/end dates only: no notices, text, IDs or geometry.
  roadWorkWindows: [start: string, end: string, count: number][]
}

export function catalogActiveRoadWorks(catalog: CityCatalog, ymd: string): number {
  return catalog.roadWorkWindows.reduce((sum, [start, end, count]) =>
    start <= ymd && ymd <= end ? sum + count : sum, 0)
}
