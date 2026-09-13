// Request metadata and response summaries only: never log timetable contents.
import assert from 'node:assert/strict'
import { setTimeout } from 'node:timers/promises'

const allowEdgeChallenge = process.argv.includes('--allow-edge-challenge')
const bases = process.argv.slice(2).filter(arg => arg !== '--allow-edge-challenge')
if (!bases.length) throw new Error('Usage: node scripts/verify-lrt-api.mjs <base-url> [base-url...]')
const production = 'https://mini-map-macau.app'
const preview = 'https://review.mini-map-macau.pages.dev'
const at = Date.parse('2026-09-11T08:00:00+08:00')
const statePath = `state?at=${at}`
class EdgeChallengeError extends Error {}
async function verify(base) {
  const host = new URL(base).hostname
  const redirected = /^(?:[a-z0-9-]+\.)?mini-map-macau\.pages\.dev$/.test(host)
  async function check(stype, headers, status, method = 'GET') {
    const res = await fetch(new URL(`/api/lrt/${stype}`, base), {
      method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000),
    })
    const context = JSON.stringify({ base, method, stype, status: res.status,
      cacheControl: res.headers.get('Cache-Control'),
      mitigation: res.headers.get('cf-mitigated'), ray: res.headers.get('cf-ray'),
    })
    if (res.status === 403 && res.headers.get('cf-mitigated') === 'challenge') {
      await res.body?.cancel()
      throw new EdgeChallengeError(context)
    }
    assert.equal(res.status, status, context)
    if (status !== 200) assert.equal(res.headers.get('Cache-Control'), 'no-store', context)
    return res
  }
  await check(statePath, {}, 403)
  await check(statePath, { 'Sec-Fetch-Site': 'same-origin' }, 403)
  await check(statePath, { Origin: 'https://example.org', Referer: production, 'Sec-Fetch-Site': 'same-origin' }, 403)
  await check(statePath, { Origin: 'null', Referer: production }, 403)
  for (const stype of ['invalid', 'toString', '__proto__', 'constructor']) {
    await check(stype, { Referer: production }, 404)
  }
  await check(statePath, { Referer: production }, 405, 'POST')
  for (const path of ['mon_thu', 'friday', 'sat_sun']) await check(path, { Origin: preview }, 410)
  for (const path of ['state', `${statePath}&duration=86400`, `${statePath}&at=${at}`]) {
    await check(path, { Origin: preview }, 400)
  }
  const res = await check(statePath, { Origin: preview }, redirected ? 307 : 200)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), preview)
  assert.match(res.headers.get('X-Robots-Tag') ?? '', /noindex/)
  if (redirected) {
    assert.equal(res.headers.get('Location'), `${production}/api/lrt/${statePath}`)
    assert.equal(await res.text(), '')
  } else {
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store')
    const vary = (res.headers.get('Vary') ?? '').toLowerCase().split(',').map(value => value.trim())
    assert.ok(vary.includes('origin') && vary.includes('referer'), 'Missing source cache variants')
    assert.match(res.headers.get('Content-Type') ?? '', /application\/json/)
    const body = await res.text()
    assert.ok(body.length < 1_000_000, 'State response exceeded size bound')
    assert.ok(!/"(?:entries|arrivalMinutes|departureMinutes|scheduleType)"/.test(body), 'Unexpected timetable fields')
    const window = JSON.parse(body)
    assert.equal(window.version, 1)
    assert.equal(window.start, at)
    assert.equal(window.end - window.start, 120000)
    assert.ok(Array.isArray(window.vehicles) && window.vehicles.length > 0 && window.vehicles.length <= 128)
    for (const vehicle of window.vehicles) {
      assert.ok(vehicle.frames.length > 0 && vehicle.frames.length <= 256)
      for (const [seconds, progress, speed] of vehicle.frames) {
        assert.ok(seconds >= 0 && seconds <= 120 && progress >= 0 && progress <= 1 && speed >= 0 && speed <= 80)
      }
      for (const stop of vehicle.stops) for (const value of [stop.arrival, stop.departure]) {
        assert.ok(value === null || (value >= window.start && value <= window.end), 'Stop escaped state window')
      }
    }
    for (const span of window.service) assert.ok(span.start >= window.start && span.end <= window.end && span.end >= span.start)
  }
  console.log(`${base}: LRT API checks passed${redirected ? ' (redirect only)' : ''}.`)
}

let verified = 0
for (const base of bases) {
  // Deployment aliases can take a moment to reach every edge. Retry briefly,
  // but still fail the deployment if the actual protection checks do not pass.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await verify(base)
      verified++
      break
    } catch (error) {
      if (allowEdgeChallenge && error instanceof EdgeChallengeError) {
        // Explicit opt-in for hosted runners: do not weaken the site's bot
        // policy just to run a probe. Local Worker checks still run in CI;
        // report the missing live coverage, and require another live endpoint.
        console.warn(`::warning title=Cloudflare challenge blocked live verification::${error.message}`)
        break
      }
      if (attempt === 4) throw error
      console.warn(`${base}: verification attempt ${attempt} failed: ${error.message}`)
      await setTimeout(10000)
    }
  }
}
assert.ok(verified > 0, 'No live endpoint could be verified; all were challenged')
