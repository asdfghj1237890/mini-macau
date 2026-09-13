import { LRT_WINDOW_STEP_MS, type LrtStateWindow } from '../src/lrtState'
const PRODUCTION_ORIGIN = 'https://mini-map-macau.app'
const PRODUCTION_ORIGINS = new Set([PRODUCTION_ORIGIN, 'https://www.mini-map-macau.app'])
const PAGE_HOST = /^(?:[a-z0-9-]+\.)?mini-map-macau\.pages\.dev$/
const RETIRED_ROUTES = new Set(['mon_thu', 'friday', 'sat_sun'])

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
  provide: (start: number) => LrtStateWindow,
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
  if (typeof stype !== 'string' || (stype !== 'state' && !RETIRED_ROUTES.has(stype))) {
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
  if (RETIRED_ROUTES.has(stype)) return new Response('Gone', { status: 410, headers })
  const query = destination.searchParams
  const at = query.get('at')
  const start = Number(at)
  if ([...query.keys()].length !== 1 || !at || !/^\d{13}$/.test(at)
    || !Number.isSafeInteger(start) || start % LRT_WINDOW_STEP_MS !== 0
    || start < Date.UTC(2000, 0, 1) || start >= Date.UTC(2100, 0, 1)) {
    return new Response('Invalid state window', { status: 400, headers })
  }
  if (isPage(destination)) {
    headers.set('Location', `${PRODUCTION_ORIGIN}/api/lrt/state?at=${start}`)
    return new Response(null, { status: 307, headers })
  }
  if (!PRODUCTION_ORIGINS.has(destination.origin) && !isLocal(destination)) {
    return new Response('Forbidden', { status: 403, headers })
  }

  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'private, no-store')
  try {
    return new Response(JSON.stringify(provide(start)), { headers })
  } catch {
    // Do not include data, stack traces, or input records in error responses.
    return new Response('State unavailable', { status: 503, headers })
  }
}
