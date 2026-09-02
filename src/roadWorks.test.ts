import { describe, it, expect } from 'vitest'
import {
  ROAD_WORKS_UPCOMING_DAYS,
  countActiveRoadWorks,
  daysBetween,
  pickText,
  roadWorkStatus,
  roadWorksHorizon,
} from './roadWorks'
import type { RoadWorkNotice } from './types'

function notice(over: Partial<RoadWorkNotice> = {}): RoadWorkNotice {
  return {
    id: '1/2026',
    restriction: 'limited',
    restrictionText: { zh: '有限度通車', pt: 'Condicionamentos' },
    location: { zh: '馬交石巷', pt: 'Travessa de Má Káu Séak' },
    reason: { zh: '搬運', pt: 'Transporte' },
    principal: { zh: '澳電', pt: 'CEM' },
    contractor: { zh: '', pt: '' },
    details: { zh: '因進行…', pt: 'Devido…' },
    duration: { days: 0, hours: 3 },
    startDate: '2026-09-10',
    endDate: '2026-09-12',
    onlineDate: '2026-09-01',
    coordinates: [113.559214, 22.20551],
    previousNotice: null,
    ...over,
  }
}

describe('roadWorkStatus', () => {
  const horizon = '2026-09-17' // 2026-09-10 + 7 days

  it('is active on the first, a middle and the last day of the period', () => {
    const n = notice({ startDate: '2026-09-10', endDate: '2026-09-12' })
    expect(roadWorkStatus(n, '2026-09-10', '2026-09-17')).toBe('active')
    expect(roadWorkStatus(n, '2026-09-11', '2026-09-18')).toBe('active')
    expect(roadWorkStatus(n, '2026-09-12', '2026-09-19')).toBe('active')
  })

  it('is upcoming from the day after "today" up to and including the horizon', () => {
    expect(roadWorkStatus(notice({ startDate: '2026-09-11' }), '2026-09-10', horizon)).toBe('upcoming')
    expect(roadWorkStatus(notice({ startDate: horizon }), '2026-09-10', horizon)).toBe('upcoming')
  })

  it('is hidden once expired or still beyond the horizon', () => {
    expect(roadWorkStatus(notice({ endDate: '2026-09-09', startDate: '2026-09-01' }), '2026-09-10', horizon)).toBeNull()
    expect(roadWorkStatus(notice({ startDate: '2026-09-18' }), '2026-09-10', horizon)).toBeNull()
  })

  it('handles multi-year periods (string compare is calendar compare)', () => {
    const n = notice({ startDate: '2025-09-01', endDate: '2026-11-30' })
    expect(roadWorkStatus(n, '2026-02-28', '2026-03-07')).toBe('active')
    expect(roadWorkStatus(n, '2026-12-01', '2026-12-08')).toBeNull()
  })
})

describe('roadWorksHorizon', () => {
  it('is exactly ROAD_WORKS_UPCOMING_DAYS after the simulated Macau day', () => {
    // 2026-09-02T16:00:00Z is 2026-09-03 00:00 in Macau.
    const horizon = roadWorksHorizon(new Date('2026-09-02T16:00:00Z'))
    expect(horizon).toBe('2026-09-10')
    expect(daysBetween('2026-09-03', horizon)).toBe(ROAD_WORKS_UPCOMING_DAYS)
  })
})

describe('countActiveRoadWorks', () => {
  it('counts only notices in force on that calendar day', () => {
    const notices = [
      notice({ id: 'a', startDate: '2026-09-01', endDate: '2026-09-30' }),
      notice({ id: 'b', startDate: '2026-09-10', endDate: '2026-09-10' }),
      notice({ id: 'c', startDate: '2026-09-20', endDate: '2026-09-25' }), // upcoming
      notice({ id: 'd', startDate: '2026-08-01', endDate: '2026-09-09' }), // expired
    ]
    expect(countActiveRoadWorks(notices, '2026-09-10')).toBe(2)
    expect(countActiveRoadWorks([], '2026-09-10')).toBe(0)
  })
})

describe('daysBetween', () => {
  it('counts whole calendar days across a month and a year boundary', () => {
    expect(daysBetween('2026-09-10', '2026-09-17')).toBe(7)
    expect(daysBetween('2026-12-28', '2027-01-02')).toBe(5)
    expect(daysBetween('2026-09-17', '2026-09-10')).toBe(-7)
  })
})

describe('pickText', () => {
  const field = { zh: '馬交石巷', pt: 'Travessa de Má Káu Séak' }

  it('gives zh for zh and pt for both pt and en', () => {
    expect(pickText(field, 'zh')).toBe('馬交石巷')
    expect(pickText(field, 'pt')).toBe('Travessa de Má Káu Séak')
    expect(pickText(field, 'en')).toBe('Travessa de Má Káu Séak')
  })

  it('falls back across the pair and tolerates a missing field', () => {
    expect(pickText({ zh: '鴻運', pt: '' }, 'en')).toBe('鴻運')
    expect(pickText({ zh: '', pt: 'CEM' }, 'zh')).toBe('CEM')
    expect(pickText(undefined, 'zh')).toBe('')
  })
})
