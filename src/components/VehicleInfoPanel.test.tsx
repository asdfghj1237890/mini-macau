import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SimulationClock, TransitData, VehiclePosition } from '../types'
import { I18nProvider } from '../i18n'
import { computeLRTVehicle, computeVehiclePositions } from '../engines/simulationEngine'
import { VehicleInfoPanel } from './VehicleInfoPanel'
import { StationInfoPanel } from './StationInfoPanel'

// Synthetic service only. Deliberately keep the clicked vehicle at zero speed
// while advancing the clock, reproducing a stale selection snapshot.
const data: TransitData = {
  lrtLines: [{ id: 'test', name: 'Test', nameCn: '測試', color: '#80bd43', stations: ['A', 'B', 'C'],
    geometry: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[113.5, 22.1], [113.5, 22.12]] } } }],
  stations: ['A', 'B', 'C'].map((id, i) => ({ id, name: id, nameCn: id, namePt: id, lineIds: ['test'], coordinates: [113.5, 22.1 + i * .01] })),
  trips: [{ id: 'test-trip', lineId: 'test', direction: 'forward', entries: [
    { stationId: 'A', arrivalMinutes: 600 }, { stationId: 'B', arrivalMinutes: 602 }, { stationId: 'C', arrivalMinutes: 604 },
  ] }],
  busRoutes: [], busStops: [], flights: [], ferries: [], roadWorks: [], schools: [], publicHousing: [],
  parishes: [], toilets: [], carParks: [], waste: [], wasteSources: [], wasteFacilities: [], wasteEcoStations: [],
  dspaStats: null, waterFacilities: [], waterNetwork: null, waterFacts: null, powerFacilities: [], powerNetwork: null,
  powerFacts: null, grandPrix: null, grandPrixSources: [], loading: false,
}
const selected: VehiclePosition = { id: 'test-trip', type: 'lrt', lineId: 'test', coordinates: [113.5, 22.1],
  bearing: 0, progress: 0, color: '#80bd43', lrtMotion: { speedKmh: 0, phase: 'stopped' } }

function render(seconds: number, transitData = data, start = '2026-05-04T10:00:00+08:00') {
  const time = new Date(Date.parse(start) + seconds * 1000)
  const clock: SimulationClock = {
    timeRef: { current: time }, getTimeMs: () => time.getTime(), readTimeMs: () => time.getTime(), subscribeTime: () => () => {},
    paused: true, speed: 1, isLive: false, setSpeed: () => {}, togglePause: () => {}, syncToNow: () => {}, setTime: () => {},
  }
  const html = renderToStaticMarkup(<I18nProvider><VehicleInfoPanel vehicle={selected} transitData={transitData} clock={clock} onClose={() => {}} /></I18nProvider>)
  const stationHtml = renderToStaticMarkup(<I18nProvider><StationInfoPanel station={transitData.stations[1]} transitData={transitData} clock={clock} onClose={() => {}} /></I18nProvider>)
  return { text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), stationHtml, time }
}

describe('VehicleInfoPanel simulation synchronization', () => {
  it('updates speed and NEXT within the same minute using the current engine state', () => {
    const first = render(25), later = render(35)
    const firstSpeed = computeLRTVehicle(data, data.trips[0], first.time)!.lrtMotion!.speedKmh.toFixed(1)
    const laterSpeed = computeLRTVehicle(data, data.trips[0], later.time)!.lrtMotion!.speedKmh.toFixed(1)
    expect(firstSpeed).not.toBe('0.0')
    expect(laterSpeed).not.toBe(firstSpeed)
    expect(first.text).toContain(`SPEED ${firstSpeed} km/h NEXT 01:35 arr`)
    expect(later.text).toContain(`SPEED ${laterSpeed} km/h NEXT 01:25 arr`)
    expect(computeLRTVehicle(data, data.trips[0], later.time)).toEqual(computeVehiclePositions(data, later.time)[0])
  })

  it('counts down the full default dwell, switches at departure and follows time scrubbing', () => {
    expect(render(120).text).toContain('SPEED 0.0 km/h NEXT 00:20 dwell')
    expect(render(120.1).text).toContain('NEXT 00:20 dwell')
    expect(render(125).text).toContain('NEXT 00:15 dwell')
    expect(render(140).text).toContain('NEXT 00:00 dwell')
    expect(render(140.1).text).toContain('NEXT 01:40 arr')
    expect(render(115).text).toContain('NEXT 00:05 arr')
    expect(render(261).text).toContain('SPEED — km/h NEXT —')
    expect(render(125).text).toContain('10:02 10:02')
    expect(render(125).text).not.toContain('10:02:20')
    expect(render(125).stationHtml).toContain('到站中')
    expect(render(141).stationHtml).not.toContain('到站中')
  })

  it('honours explicit dwell seconds without displaying the first ARR placeholder', () => {
    const dwelling = { ...data, trips: [{ ...data.trips[0], entries: data.trips[0].entries.map((e, i) => i === 0 ? { ...e, departureMinutes: 600.25 } : e) }] }
    expect(render(5, dwelling).text).toContain('SPEED 0.0 km/h NEXT 00:10 dwell')
    expect(render(16, dwelling).text).toContain('NEXT 01:44 arr')
  })

  it('keeps overnight speed and NEXT aligned with the map service day', () => {
    const overnight: TransitData = { ...data, trips: [{ ...data.trips[0], scheduleType: 'mon_thu', entries: [
      { stationId: 'A', arrivalMinutes: 1439 }, { stationId: 'B', arrivalMinutes: 1441 },
    ] }] }
    const state = render(10, overnight, '2026-05-08T00:00:00+08:00')
    expect(state.text).toContain('NEXT 00:50 arr')
    const live = computeLRTVehicle(overnight, overnight.trips[0], state.time)!
    expect(live.lrtMotion!.speedKmh).toBeGreaterThan(0)
    expect(state.text).toContain(`SPEED ${live.lrtMotion!.speedKmh.toFixed(1)} km/h`)
    expect(live).toEqual(computeVehiclePositions(overnight, state.time)[0])
  })
})
