// Road-works (DSAT 工程改道) helpers shared by App, MapView, the legend and
// the info panel. The active/upcoming rule lives here exactly once so the
// marker layer, the legend count and the panel can never disagree.
//
// All dates are Macau-local YYYY-MM-DD calendar days (see `macauYmd`). ISO
// dates sort lexicographically, so plain string comparison IS calendar
// comparison — no Date objects in the hot path.
import type { Lang, Translations } from './i18n'
import { macauYmd } from './macauTime'
import type { RoadWorkNotice, RoadWorkRestriction, RoadWorkText } from './types'

// How far ahead a not-yet-started notice is previewed on the map.
export const ROAD_WORKS_UPCOMING_DAYS = 7

const MS_PER_DAY = 86400000

export type RoadWorkStatus = 'active' | 'upcoming'

// Marker colours, keyed by restriction. Red = the road is shut, amber = you
// can still get through, slate-blue = parking-only restriction.
export const ROAD_WORK_COLORS: Record<RoadWorkRestriction, string> = {
  closed: '#ef4444',
  limited: '#f59e0b',
  one_way: '#f59e0b',
  other: '#f59e0b',
  no_parking: '#64748b',
}

// `null` = not shown on the simulated day. `ymdHorizon` is the calendar day
// ROAD_WORKS_UPCOMING_DAYS after `ymd` (see `roadWorksHorizon`).
export function roadWorkStatus(
  notice: RoadWorkNotice,
  ymd: string,
  ymdHorizon: string,
): RoadWorkStatus | null {
  if (notice.startDate <= ymd && ymd <= notice.endDate) return 'active'
  if (ymd < notice.startDate && notice.startDate <= ymdHorizon) return 'upcoming'
  return null
}

// The far edge of the "upcoming" window for a simulated instant, as a Macau
// calendar day.
export function roadWorksHorizon(instant: Date): string {
  return macauYmd(new Date(instant.getTime() + ROAD_WORKS_UPCOMING_DAYS * MS_PER_DAY))
}

// Notices in force on the given Macau calendar day (ignores upcoming ones —
// this is what the legend counts).
export function countActiveRoadWorks(notices: RoadWorkNotice[], ymd: string): number {
  let n = 0
  for (const notice of notices) {
    if (notice.startDate <= ymd && ymd <= notice.endDate) n++
  }
  return n
}

// Whole calendar days between two YYYY-MM-DD strings (`to` - `from`). Parsed
// as UTC midnights so the arithmetic is a pure calendar diff, independent of
// the viewer's timezone and of DST anywhere.
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / MS_PER_DAY)
}

// The upstream feed carries only zh + pt. English readers get the Portuguese
// form: Macau street/company names are officially Portuguese and there is no
// English rendering to fall back to (a Latin-script name also beats Chinese
// for a non-Chinese reader). Falls back across the pair if one side is blank.
export function pickText(field: RoadWorkText | undefined, lang: Lang): string {
  if (!field) return ''
  if (lang === 'zh') return field.zh || field.pt || ''
  return field.pt || field.zh || ''
}

// UI label for a restriction. Uses the normalised enum rather than the
// upstream `restrictionText` so the three UI languages stay consistent (the
// feed's own wording is zh/pt only, and varies: "有限度通車*",
// "有限度通車(佔用一條行車道)", …).
export function restrictionLabel(t: Translations, restriction: RoadWorkRestriction): string {
  switch (restriction) {
    case 'closed': return t.roadWorkClosed
    case 'limited': return t.roadWorkLimited
    case 'one_way': return t.roadWorkOneWay
    case 'no_parking': return t.roadWorkNoParking
    default: return t.roadWorkOther
  }
}
