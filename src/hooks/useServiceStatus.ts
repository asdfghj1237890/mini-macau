import { useEffect, useState } from 'react'

const SNAPSHOT_URL =
  'https://raw.githubusercontent.com/asdfghj1237890/mini-macau/data-snapshot/service-status.json'

interface ServiceStatusPayload {
  date: string
  dayCategory: string
  isHoliday: boolean
  inactive: string[]
}

export interface ServiceStatus {
  inactive: Set<string>
  date: string | null
  dayCategory: string | null
  loaded: boolean
}

const EMPTY: ServiceStatus = {
  inactive: new Set(),
  date: null,
  dayCategory: null,
  loaded: false,
}

export function useServiceStatus(): ServiceStatus {
  const [status, setStatus] = useState<ServiceStatus>(EMPTY)

  useEffect(() => {
    let cancelled = false
    fetch(SNAPSHOT_URL, { cache: 'no-cache' })
      .then(r => (r.ok ? (r.json() as Promise<ServiceStatusPayload>) : null))
      .then(payload => {
        if (cancelled || !payload) return
        setStatus({
          inactive: new Set(payload.inactive ?? []),
          date: payload.date ?? null,
          dayCategory: payload.dayCategory ?? null,
          loaded: true,
        })
      })
      .catch(() => { /* no snapshot yet — all routes remain active */ })
    return () => { cancelled = true }
  }, [])

  return status
}
