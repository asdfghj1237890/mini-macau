import { describe, expect, it } from 'vitest'
import { serveLrt } from './lrt-api'

// Synthetic fixtures only: these tests must run without the private timetable.
const bodies = { mon_thu: '[1]', friday: '[2]', sat_sun: '[3]' }
const site = 'https://mini-map-macau.app'
const preview = 'https://review-123.mini-map-macau.pages.dev'
function respond(headers: Record<string, string> = {}, stype: string | string[] | undefined = 'friday', origin = site, method = 'GET') {
  return serveLrt(new Request(`${origin}/api/lrt/${stype}`, { headers, method }), stype, bodies)
}

describe('LRT API access and routing', () => {
  it.each<Record<string, string>>([
    {},
    { 'Sec-Fetch-Site': 'same-origin' },
    { Origin: 'https://example.org', 'Sec-Fetch-Site': 'same-origin', Referer: site },
    { Origin: 'null', Referer: site },
    { Origin: '', Referer: site },
    { Origin: 'invalid', Referer: site },
    { Origin: `${site}/path`, Referer: site },
    { Referer: 'https://mini-map-macau.app.example.org/' },
    { Referer: 'http://mini-map-macau.app/' },
    { Referer: 'https://mini-map-macau.app:444/' },
    { Referer: 'https://user@mini-map-macau.app/' },
    { Origin: 'http://localhost:5173' },
    { Origin: 'https://a.b.mini-map-macau.pages.dev' },
  ])('rejects missing or untrusted sources: %j', headers => {
    const response = respond(headers)
    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })

  it.each(['mon_thu', 'friday', 'sat_sun'] as const)('serves %s with private caching', async stype => {
    const response = respond({ Referer: `${site}/` }, stype)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(bodies[stype])
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600')
    expect(response.headers.get('Vary')).toBe('Origin, Referer')
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
    expect(response.headers.get('Content-Type')).toContain('application/json')
  })

  it.each(['', 'invalid', 'toString', '__proto__', 'constructor', ['friday', 'mon_thu']])('rejects invalid schedule %j', stype => {
    expect(respond({ Referer: site }, stype).status).toBe(404)
  })

  it.each(['POST', 'HEAD', 'OPTIONS'])('rejects %s instead of falling through to the SPA', method => {
    const response = respond({ Referer: site }, 'friday', site, method)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
  })

  it('allows preview browsers to read the production API with scoped CORS', () => {
    const response = respond({ Origin: preview })
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(preview)
  })

  it.each(['https://mini-map-macau.pages.dev', preview])('redirects %s without a timetable body', async origin => {
    const response = respond({ Origin: preview }, 'friday', origin)
    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe(`${site}/api/lrt/friday`)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('')
  })

  it('rejects an unconfigured destination even with an allowed Referer', () => {
    expect(respond({ Referer: site }, 'friday', 'https://example.org').status).toBe(403)
  })

  it('allows loopback sources only when testing on that same local origin', () => {
    const local = 'http://127.0.0.1:8788'
    expect(respond({ Referer: `${local}/` }, 'friday', local).status).toBe(200)
    expect(respond({ Referer: `${local}/` }).status).toBe(403)
  })
})
