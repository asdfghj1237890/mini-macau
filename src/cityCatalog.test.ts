import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { buildCityCatalog } from '../plugins/city-catalog'
import { catalogActiveRoadWorks } from './cityCatalog'
import { countSchoolsByLevel } from './schools'
import { countPublicHousingByType } from './publicHousing'
import { countWasteByType, wasteIncinerator } from './waste'
import { countActiveRoadWorks } from './roadWorks'
import type { RoadWorkNotice } from './types'

it('builds compact counts matching the full city data and existing filters', async () => {
  const catalog = await buildCityCatalog('public/data')
  const [schools, housing, waste, power, works] = await Promise.all(
    ['schools', 'public-housing', 'waste', 'power-facilities', 'road-works'].map(async name =>
      JSON.parse(await readFile(`public/data/${name}.json`, 'utf8'))))
  expect(catalog.schoolLevels).toEqual(countSchoolsByLevel(schools.schools))
  expect(catalog.housingTypes).toEqual(countPublicHousingByType(housing.estates))
  expect(catalog.wasteTypes).toEqual(countWasteByType(waste.sites, {
    incinerator: wasteIncinerator(power.facilities), ecoStations: waste.ecoStations, facilities: waste.facilities,
  }))
  // Every interval boundary, including inclusive ends, plus out-of-range dates.
  const dates = ['1900-01-01', '2100-01-01', ...works.notices.flatMap((n: RoadWorkNotice) => [n.startDate, n.endDate])]
  for (const day of dates) expect(catalogActiveRoadWorks(catalog, day)).toBe(countActiveRoadWorks(works.notices, day))
  expect(Object.keys(catalog.counts)).toHaveLength(10)
  expect(Object.values(catalog.counts).every(n => n > 0)).toBe(true)
  const json = JSON.stringify(catalog)
  expect(json).not.toMatch(/coordinates|geometry|notices|schoolName|estateName/)
  expect(Buffer.byteLength(json)).toBeLessThan(20_000)
})
