import { useEffect, useRef, useState } from 'react'
import {
  CAR_PARK_VACANCY_URL,
  DSAT_CARPARK_APPCODE,
  parseCarParkVacancyXml,
} from '../carParks'
import type { CarParkVacancy } from '../types'

// DSAT republishes the feed every 10 s. Polling at 10 s would be three
// requests per park-minute for a number most viewers glance at once, so 30 s
// is the compromise: still "live" to a human, a third of the traffic.
const POLL_MS = 30_000

export interface CarParkVacancyState {
  // id → live row, or null whenever there is nothing FRESH to show: before the
  // first successful fetch, and from the instant polling stops. Numbers must
  // never outlive the polling window — a count frozen at 5× would read as
  // current — so this goes null the moment the rule turns false, which is what
  // wipes the map labels in the same render.
  vacancy: Map<string, CarParkVacancy> | null
  // When the last successful fetch completed.
  updatedAt: Date | null
  // Whether the feed is being polled right now. False means the numbers on
  // screen are frozen, which the panel says out loud.
  polling: boolean
}

function isTabVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

// Live vacancy for the car-park overlay. Polls ONLY while `enabled` (the
// caller ANDs the layer switch with `clock.speed === 1`: at 5× the simulated
// clock is not "now", so a real-time number would be a lie) AND the tab is
// visible. First fetch fires immediately when that becomes true; the interval
// and any in-flight request are torn down when it becomes false.
export function useCarParkVacancy(enabled: boolean): CarParkVacancyState {
  const [vacancy, setVacancy] = useState<Map<string, CarParkVacancy> | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [visible, setVisible] = useState(isTabVisible)
  // Failure streak, so a dead upstream logs once instead of every 30 s.
  const failuresRef = useRef(0)

  useEffect(() => {
    const onVis = () => setVisible(isTabVisible())
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const polling = enabled && visible

  // Drop the last numbers as soon as the rule turns false, so switching back
  // to 1× shows nothing until the first fresh response lands rather than
  // flashing whatever was on screen a minute ago.
  useEffect(() => {
    if (polling) return
    setVacancy(null)
    setUpdatedAt(null)
  }, [polling])

  useEffect(() => {
    if (!polling) return
    const controller = new AbortController()
    let stopped = false

    const run = async () => {
      try {
        const res = await fetch(CAR_PARK_VACANCY_URL, {
          headers: { Authorization: `APPCODE ${DSAT_CARPARK_APPCODE}` },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const parsed = parseCarParkVacancyXml(await res.text())
        if (stopped) return
        if (parsed.size === 0) throw new Error('no rows')
        failuresRef.current = 0
        // A fresh Map identity is what tells MapView to redraw the labels.
        setVacancy(parsed)
        setUpdatedAt(new Date())
      } catch (err) {
        if (stopped || controller.signal.aborted) return
        // Keep the last good data and retry on the next tick; warn once per
        // streak so a long outage doesn't spam the console.
        if (failuresRef.current === 0) {
          console.warn('[car-parks] live vacancy fetch failed', err)
        }
        failuresRef.current += 1
      }
    }

    void run()
    const iv = setInterval(() => { void run() }, POLL_MS)
    return () => {
      stopped = true
      clearInterval(iv)
      controller.abort()
    }
  }, [polling])

  // The `polling &&` guard is not redundant with the effect above: it makes
  // the labels disappear in the SAME render as the speed change, instead of
  // one commit later.
  return { vacancy: polling ? vacancy : null, updatedAt: polling ? updatedAt : null, polling }
}
