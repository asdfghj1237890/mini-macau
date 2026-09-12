import { describe, expect, it, vi } from 'vitest'
import { AsyncBusFrame, type BusWorkerPort } from './asyncBusFrame'
import type { BusRoute, BusStop, VehiclePosition } from '../types'
import type { BusWorkerReply, BusWorkerRequest } from './busWorkerRuntime'
import { computeBusOnly } from './simulationEngine'

vi.mock('./simulationEngine', () => ({ computeBusOnly: vi.fn((data: { busRoutes: BusRoute[] }) =>
  data.busRoutes.map(route => ({ id: `${route.id}-0`, lineId: route.id }))) }))

const route = { id: '1' } as BusRoute
const data = { busRoutes: [route], busStops: [] as BusStop[] }
const vehicle = { id: '1-0', lineId: '1' } as VehiclePosition
function setup() {
  const sent: BusWorkerRequest[] = []
  const port: BusWorkerPort = { onmessage: null, onerror: null, onmessageerror: null,
    postMessage: request => { sent.push(request) }, terminate: vi.fn() }
  const frame = new AsyncBusFrame(() => port)
  const reply = (request = sent.at(-1)!, vehicles = [vehicle]) => port.onmessage?.({ data: {
    id: request.id, epoch: request.epoch, simMs: request.simMs, vehicles,
  } } as MessageEvent<BusWorkerReply>)
  return { sent, port, frame, reply }
}

describe('background bus frame', () => {
  it('coalesces fast clock updates and transfers static bus data only once', () => {
    const { sent, frame, reply } = setup()
    frame.sample(data, 1000)
    for (let ms = 1100; ms <= 5000; ms += 100) frame.sample(data, ms)
    expect(sent).toHaveLength(1)
    expect(Object.keys(sent[0]).sort()).toEqual(['epoch', 'id', 'reset', 'routeKeys', 'routes', 'simMs', 'stops'])
    reply()
    expect(frame.sample(data, 5000).vehicles).toEqual([vehicle])
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(expect.objectContaining({ simMs: 5000 }))
    expect(sent[1].routes).toBeUndefined()
    expect(sent[1].stops).toBeUndefined()
  })

  it('accepts the final paused result without starting more work', () => {
    const { sent, frame, reply } = setup()
    expect(frame.sample(data, 1000).pending).toBe(true)
    reply()
    const final = frame.sample(data, 1000)
    expect(final.pending).toBe(false)
    expect(final.vehicles).toEqual([vehicle])
    for (let i = 0; i < 100; i++) expect(frame.sample(data, 1000).vehicles).toBe(final.vehicles)
    expect(sent).toHaveLength(1)
  })

  it('lets tracking clear a bus that left service even while the next update is computing', () => {
    const { frame, reply } = setup()
    frame.sample(data, 1000); reply()
    expect(frame.sample(data, 1100).pending).toBe(false)
    reply(undefined, [])
    expect(frame.sample(data, 1200)).toEqual({ vehicles: [], pending: false })
  })

  it('retains a completed fleet during throttled 60× playback and equivalent route arrays', () => {
    const { sent, frame, reply } = setup()
    frame.sample(data, 1000, 0); reply()
    const next = frame.sample({ ...data, busRoutes: [...data.busRoutes] }, 61000, 1000)
    expect(next).toEqual({ vehicles: [vehicle], pending: false })
    expect(sent[1].reset).toBe(false)
    expect(sent[1].routes).toBeUndefined()
  })

  it.each([900, 20000])('rejects stale replies after seeking to %i and explicitly resets the queue', simMs => {
    const { sent, frame, reply } = setup()
    frame.sample(data, 1000)
    const old = sent[0]
    frame.sample(data, simMs)
    reply(old)
    expect(frame.sample(data, simMs).vehicles).toEqual([])
    expect(sent[1].reset).toBe(true)
    reply()
    expect(frame.sample(data, simMs).vehicles).toEqual([vehicle])
  })

  it('hides disabled routes immediately, rejects old work and reuses route identities on restore', () => {
    const { sent, frame, reply } = setup()
    frame.sample(data, 1000); reply()
    frame.sample(data, 1100)
    const disabled = { ...data, busRoutes: [] }
    expect(frame.sample(disabled, 1100).vehicles).toEqual([])
    reply()
    expect(frame.sample(disabled, 1100).vehicles).toEqual([])
    expect(sent.at(-1)?.routeKeys).toEqual([])
    reply(sent.at(-1), [])
    frame.sample(data, 1100)
    expect(sent.at(-1)?.routes).toEqual([])
    expect(sent.at(-1)?.routeKeys).toEqual(sent[0].routeKeys)
  })

  it('disposes the worker and ignores late completions', () => {
    const { port, sent, frame, reply } = setup()
    frame.sample(data, 1000)
    frame.dispose(); reply()
    expect(port.terminate).toHaveBeenCalledOnce()
    expect(frame.sample(data, 2000)).toEqual({ vehicles: [], pending: false })
    expect(sent).toHaveLength(1)
  })

  it('falls back when worker construction, messaging or execution fails', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const empty = { busRoutes: [], busStops: [] }
    const failed = new AsyncBusFrame(() => { throw new Error('blocked') })
    expect(failed.sample(data, 1000)).toEqual({ vehicles: [vehicle], pending: false })
    vi.mocked(computeBusOnly).mockClear()
    failed.sample(data, 1000)
    expect(computeBusOnly).not.toHaveBeenCalled()
    expect(failed.sample(empty, 1000)).toEqual({ vehicles: [], pending: false })
    const messaging = setup()
    messaging.port.postMessage = () => { throw new Error('clone error') }
    messaging.frame.sample(data, 1000)
    expect(messaging.frame.sample(data, 1000)).toEqual({ vehicles: [vehicle], pending: false })
    const { frame, port } = setup()
    frame.sample(data, 1000)
    port.onerror?.({} as ErrorEvent)
    expect(frame.sample(empty, 1000)).toEqual({ vehicles: [], pending: false })
    expect(port.terminate).toHaveBeenCalledOnce()
    warning.mockRestore()
  })
})
