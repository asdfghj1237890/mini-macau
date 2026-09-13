import { describe, expect, it, vi } from 'vitest'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import { computeScheduledLrt as computeVehiclePositions } from '../../server/lrt-simulation'
import type { LRTLine, Station, TransitData, Trip } from '../types'

vi.mock('@turf/nearest-point-on-line', async importOriginal => {
  const original = await importOriginal<typeof import('@turf/nearest-point-on-line')>()
  return { ...original, default: vi.fn(original.default) }
})

function fixture(): TransitData {
  const track: LRTLine = { id: 'test', name: 'Test', nameCn: '測試', color: '#123456', stations: ['a', 'b'],
    geometry: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[113.5, 22.1], [113.51, 22.1]] } } }
  const stations: Station[] = ['a', 'b'].map((id, i) => ({ id, name: id, nameCn: id, namePt: id,
    coordinates: [113.5 + i * .01, 22.1], lineIds: ['test'] }))
  const trips: Trip[] = [{ id: 'synthetic', lineId: 'test', direction: 'forward', scheduleType: 'friday',
    entries: [{ stationId: 'a', arrivalMinutes: 480 }, { stationId: 'b', arrivalMinutes: 485 }] }]
  return { lrtLines: [track], stations, trips, busRoutes: [], busStops: [], flights: [], ferries: [] } as unknown as TransitData
}
const morning = new Date('2026-09-11T08:00:01+08:00')

describe('server LRT geometry caches', () => {
  it('reuses projections across unrelated data changes, filtered arrays and alternating dataset views', () => {
    const data = fixture()
    vi.mocked(nearestPointOnLine).mockClear()
    const first = computeVehiclePositions(data, morning)
    expect(nearestPointOnLine).toHaveBeenCalledTimes(4)
    for (let i = 0; i < 20; i++) {
      const copy = { ...data, lrtLines: [...data.lrtLines], busRoutes: [], flights: [] }
      expect(computeVehiclePositions(copy, morning)).toEqual(first)
      expect(computeVehiclePositions({ ...data, lrtLines: [] }, morning)).toEqual([])
      expect(computeVehiclePositions(data, morning)).toEqual(first)
    }
    expect(nearestPointOnLine).toHaveBeenCalledTimes(4)
  })

  it('reprojects changed stations/lines and picks up replaced trips without stale positions', () => {
    const data = fixture()
    const first = computeVehiclePositions(data, morning)[0]
    vi.mocked(nearestPointOnLine).mockClear()
    const moved = { ...data, stations: data.stations.map(s => s.id === 'a' ? { ...s, coordinates: [113.505, 22.1] as [number, number] } : s) }
    expect(computeVehiclePositions(moved, morning)[0].coordinates[0]).toBeGreaterThan(first.coordinates[0] + .004)
    expect(nearestPointOnLine).toHaveBeenCalledTimes(4)
    const line = data.lrtLines[0]
    const changed = { ...data, lrtLines: [{ ...line, geometry: { ...line.geometry, geometry: {
      ...line.geometry.geometry, coordinates: [[113.5, 22.101], [113.51, 22.101]],
    } } }] }
    expect(computeVehiclePositions(changed, morning)[0].coordinates[1]).toBeGreaterThan(first.coordinates[1] + .0009)
    expect(nearestPointOnLine).toHaveBeenCalledTimes(8)
    expect(computeVehiclePositions({ ...data, trips: [] }, morning)).toEqual([])
    expect(computeVehiclePositions(data, morning)[0]).toEqual(first)
  })
})
