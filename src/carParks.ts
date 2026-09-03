// Public car-park (DSAT 停車場) helpers shared by MapView (the marker layer),
// the legend, the info panel and the live-vacancy hook. Two upstream datasets
// meet here:
//
//   * the STATIC list — 88 parks with names, fees and coordinates — which the
//     Python pipeline commits to public/data/car-parks.json, and
//   * the LIVE vacancy feed (`car_park_maintance`), refreshed by DSAT every
//     10 s, which the browser polls directly because the API gateway answers
//     with `Access-Control-Allow-Origin: *` and allows the Authorization
//     header. Nothing about it is committed.
//
// Everything that turns a raw feed row into something the UI can render lives
// in this file so the map label, the panel and the tests can never disagree.
import type { Lang } from './i18n'
import { macauWallToInstant } from './macauTime'
import type { CarPark, CarParkText, CarParkVacancy } from './types'

// The APPCODE the data.gov.mo API gateway wants in `Authorization`. It is
// printed in plain sight on the dataset page for every anonymous visitor
// (data.gov.mo/Detail?id=ea50a770-…, "API信息" → Authorization), so it is a
// public identifier for the dataset rather than a secret — shipping it in the
// bundle is deliberate and lets the browser poll without a proxy. The pipeline
// side still reads it from `DATAGOVMO_APPCODE` and keeps it out of the repo.
export const DSAT_CARPARK_APPCODE = '09d43a591fba407fb862412970667de4'

// Live vacancy. `lang=zh_TW` only affects the `name` attribute, which we
// ignore — the names come from the committed static file.
export const CAR_PARK_VACANCY_URL =
  'https://dsat.apigateway.data.gov.mo/car_park_maintance?lang=zh_TW'

// Marker blue. Also the panel's header accent, so the pin the user clicked and
// the panel that opens read as the same object.
export const CAR_PARK_COLOR = '#3b82f6'

// Name of the registered MapLibre image, kept next to the colour so the
// `map.addImage` call and the symbol layer's `icon-image` read one string.
export const CAR_PARK_ICON_NAME = 'car-park'

// Localised field text. Unlike the trilingual IAM toilet feed, DSAT has no
// real English names: `NameE` is nearly always a copy of the Portuguese form,
// and a handful of records leave the English side blank. So `en` falls back to
// Portuguese before Chinese (en → pt → zh), which is what a non-Chinese reader
// can actually use.
export function pickCarParkText(field: CarParkText | undefined, lang: Lang): string {
  if (!field) return ''
  if (lang === 'zh') return field.zh || field.pt || field.en || ''
  if (lang === 'pt') return field.pt || field.en || field.zh || ''
  return field.en || field.pt || field.zh || ''
}

// One Point feature per car park. `vacancy` is optional: when a live row for
// this park exists, is not suspended and reports a car count, that number is
// attached as a string so the symbol layer can draw it with `['get','vacancy']`
// (a missing property renders as no label, which is exactly the "unknown"
// case). `sortKey` is the numeric CP_ID: the label layer collides labels
// against each other (two entrances of the same building are metres apart), so
// placement needs a STABLE priority — ascending id means the same neighbour
// keeps its number instead of the pair flickering as the map moves. Records
// with no usable coordinate pair are skipped rather than emitted as broken
// geometry.
export function buildCarParkFeatures(
  carParks: CarPark[],
  vacancy?: Map<string, CarParkVacancy> | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const park of carParks) {
    const coords = park.coordinates
    if (!coords || coords.length < 2) continue
    const numericId = Number(park.id)
    const properties: Record<string, string | number> = {
      id: park.id,
      icon: CAR_PARK_ICON_NAME,
      // A non-numeric id would poison the sort; park those at the end.
      sortKey: Number.isFinite(numericId) ? numericId : Number.MAX_SAFE_INTEGER,
    }
    const live = vacancy?.get(park.id)
    if (live && !live.maintenance && live.car !== null) {
      properties.vacancy = String(live.car)
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords[0], coords[1]] },
      properties,
    })
  }
  return { type: 'FeatureCollection', features }
}

// ---- car_park_maintance XML ---------------------------------------------
// The payload is one flat `<CarPark>` root of attribute-only
// `<Car_park_info … />` elements. Parsing runs through DOMParser in the
// browser; the regex scan below is the fallback for environments with no DOM
// (the unit tests, and any future SSR pass). Both funnel into `rowFromAttrs`,
// so the meaning of the attributes is defined exactly once.

const ROW_RE = /<Car_park_info\b([^>]*)>/g
const ATTR_RE = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

type Attrs = Record<string, string>

function rowsFromDom(text: string): Attrs[] | null {
  if (typeof DOMParser === 'undefined') return null
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(text, 'text/xml')
  } catch {
    return null
  }
  // A malformed body yields a <parsererror> document instead of throwing.
  if (doc.getElementsByTagName('parsererror').length > 0) return null
  const els = doc.getElementsByTagName('Car_park_info')
  if (els.length === 0) return null
  const rows: Attrs[] = []
  for (const el of Array.from(els)) {
    const attrs: Attrs = {}
    for (const a of Array.from(el.attributes)) attrs[a.name] = a.value
    rows.push(attrs)
  }
  return rows
}

function rowsFromRegex(text: string): Attrs[] {
  const rows: Attrs[] = []
  ROW_RE.lastIndex = 0
  let row: RegExpExecArray | null
  while ((row = ROW_RE.exec(text)) !== null) {
    const attrs: Attrs = {}
    ATTR_RE.lastIndex = 0
    let attr: RegExpExecArray | null
    while ((attr = ATTR_RE.exec(row[1])) !== null) {
      attrs[attr[1]] = decodeXml(attr[2])
    }
    rows.push(attrs)
  }
  return rows
}

// "" (the park does not report this category), "-" and anything non-numeric
// all mean "unknown" → null. "0" is a real count and must survive.
function count(raw: string | undefined): number | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// `Time` is Macau wall clock in US order: "9/3/2026 4:21:04 PM". Parsed into
// the instant that Macau clock reading corresponds to (NOT `new Date(str)`,
// which would read it in the viewer's zone), so the panel can format it with
// the usual macauTime helpers. Suspended rows publish "-", which stays raw
// with a null instant.
export function parseCarParkTime(raw: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i
    .exec(raw.trim())
  if (!m) return null
  const [, mon, day, year, hh, mm, ss, ampm] = m
  let hours = Number(hh)
  if (ampm) {
    const pm = ampm.toUpperCase() === 'PM'
    if (hours === 12) hours = pm ? 12 : 0
    else if (pm) hours += 12
  }
  if (hours > 23) return null
  return macauWallToInstant(
    Number(year), Number(mon) - 1, Number(day), hours, Number(mm), Number(ss),
  )
}

function rowFromAttrs(attrs: Attrs): CarParkVacancy | null {
  const id = (attrs.ID ?? '').trim()
  if (!id) return null
  const time = attrs.Time ?? ''
  return {
    id,
    car: count(attrs.Car_CNT),
    moto: count(attrs.MB_CNT),
    eMoto: count(attrs.OT_A_CNT),
    eCar: count(attrs.ELC_CNT),
    disabled: count(attrs.DC_CNT),
    maintenance: (attrs.maintenance ?? '').trim() === '1',
    time,
    timeParsed: parseCarParkTime(time),
  }
}

// Parse a car_park_maintance response into `id → row`. Unknown/garbage input
// yields an empty map rather than throwing — the caller keeps its last good
// data and retries on the next tick.
export function parseCarParkVacancyXml(text: string): Map<string, CarParkVacancy> {
  const rows = rowsFromDom(text) ?? rowsFromRegex(text)
  const out = new Map<string, CarParkVacancy>()
  for (const attrs of rows) {
    const row = rowFromAttrs(attrs)
    if (row) out.set(row.id, row)
  }
  return out
}
