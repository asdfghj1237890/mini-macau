import { useState, useEffect } from 'react'
import type { TransitData, LRTLine, Station, Trip, BusRoute, BusStop } from '../types'

async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  return res.json() as Promise<T>
}

export function useTransitData(): TransitData {
  const [data, setData] = useState<TransitData>({
    lrtLines: [],
    stations: [],
    trips: [],
    busRoutes: [],
    busStops: [],
    loading: true,
  })

  useEffect(() => {
    Promise.all([
      loadJson<LRTLine[]>('/data/lrt-lines.json'),
      loadJson<Station[]>('/data/stations.json'),
      loadJson<Trip[]>('/data/trips.json'),
      loadJson<BusRoute[]>('/data/bus-routes.json').catch(() => []),
      loadJson<BusStop[]>('/data/bus-stops.json').catch(() => []),
    ]).then(([lrtLines, stations, trips, busRoutes, busStops]) => {
      setData({ lrtLines, stations, trips, busRoutes, busStops, loading: false })
    }).catch(err => {
      console.error('Failed to load transit data:', err)
      setData(prev => ({ ...prev, loading: false }))
    })
  }, [])

  return data
}
