import type { VehiclePosition } from '../types'
import { BUS_HALF_LENGTH_M, BUS_HEIGHT_M } from './busMesh'

export function busesInBounds(buses: VehiclePosition[], bounds: { getWest(): number; getEast(): number; getSouth(): number; getNorth(): number }): VehiclePosition[] {
  const west = bounds.getWest(), east = bounds.getEast(), south = bounds.getSouth(), north = bounds.getNorth()
  // Include an apron beyond the visible ground for pitched roofs, mirrors and
  // camera movement between fleet uploads. Macau does not cross the antimeridian.
  return buses.filter(v => {
    const latPad = (160 * Math.max(1, v.scale ?? 1) + Math.max(0, v.altitude ?? 0) * 12) / 111320
    const lngPad = latPad / Math.max(Math.cos(v.coordinates[1] * Math.PI / 180), 1e-6)
    return v.coordinates[0] >= west - lngPad && v.coordinates[0] <= east + lngPad &&
      v.coordinates[1] >= south - latPad && v.coordinates[1] <= north + latPad
  })
}

// One invisible body envelope per bus preserves map picking. Mirrors are
// excluded so closely passing buses have separate hit targets.
export function buildBusFeatures(buses: VehiclePosition[]): GeoJSON.Feature<GeoJSON.Polygon>[] {
  return buses.map(v => {
    const [lng, lat] = v.coordinates
    const scale = v.scale ?? 1, altitude = v.altitude ?? 0
    const a = v.bearing * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a)
    const latUnit = scale / 111320, lngUnit = latUnit / Math.max(Math.cos(lat * Math.PI / 180), 1e-6)
    const l = BUS_HALF_LENGTH_M, w = 2.6
    return {
      type: 'Feature',
      properties: { vehicleId: v.id, baseM: altitude, heightM: altitude + BUS_HEIGHT_M * scale },
      geometry: { type: 'Polygon', coordinates: [[[-w, l], [w, l], [w, -l], [-w, -l], [-w, l]].map(([x, y]) =>
        [lng + (x * cos + y * sin) * lngUnit, lat + (-x * sin + y * cos) * latUnit])] },
    }
  })
}
