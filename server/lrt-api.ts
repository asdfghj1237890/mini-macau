const PRODUCTION_ORIGIN = 'https://mini-map-macau.app'
const PRODUCTION_ORIGINS = new Set([PRODUCTION_ORIGIN, 'https://www.mini-map-macau.app'])
const PAGE_HOST = /^(?:[a-z0-9-]+\.)?mini-map-macau\.pages\.dev$/
const SCHEDULE_TYPES = new Set(['mon_thu', 'friday', 'sat_sun'])
type ScheduleType = 'mon_thu' | 'friday' | 'sat_sun'

function parseUrl(value: string | null): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.username || url.password ? null : url
  } catch {
    return null
  }
}

function isLocal(url: URL): boolean {
  return (url.protocol === 'http:' || url.protocol === 'https:')
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

function isPage(url: URL): boolean {
  return url.protocol === 'https:' && !url.port && PAGE_HOST.test(url.hostname)
}

function allowedSource(source: URL, destination: URL): boolean {
  return PRODUCTION_ORIGINS.has(source.origin) || isPage(source)
    || (isLocal(destination) && source.origin === destination.origin)
}

// Origin/Referer checks discourage cross-site reuse; non-browser clients can
// forge them. They are not authentication. All deployed data responses use the
// production domain so its WAF rate limit cannot be bypassed via pages.dev.
export function serveLrt(
  request: Request,
  stype: string | string[] | undefined,
  bodies: Record<ScheduleType, string>,
): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Vary': 'Origin, Referer',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method !== 'GET') {
    headers.set('Allow', 'GET')
    return new Response('Method not allowed', { status: 405, headers })
  }
  if (typeof stype !== 'string' || !SCHEDULE_TYPES.has(stype)) {
    return new Response('Not found', { status: 404, headers })
  }

  const destination = new URL(request.url)
  // A present but invalid/disallowed Origin must never fall back to Referer.
  const origin = request.headers.get('Origin')
  const source = parseUrl(origin !== null ? origin : request.headers.get('Referer'))
  if (!source || (origin !== null && origin !== source.origin)
    || !allowedSource(source, destination)) {
    return new Response('Forbidden', { status: 403, headers })
  }

  if (origin !== null) headers.set('Access-Control-Allow-Origin', source.origin)
  if (isPage(destination)) {
    headers.set('Location', `${PRODUCTION_ORIGIN}/api/lrt/${stype}`)
    return new Response(null, { status: 307, headers })
  }
  if (!PRODUCTION_ORIGINS.has(destination.origin) && !isLocal(destination)) {
    return new Response('Forbidden', { status: 403, headers })
  }

  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'private, max-age=3600')
  return new Response(bodies[stype as ScheduleType], { headers })
}
