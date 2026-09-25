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
function setup(onOverload?: (speed: number) => void) {
  const sent: BusWorkerRequest[] = []
  const port: BusWorkerPort = { onmessage: null, onerror: null, onmessageerror: null,
    postMessage: request => { sent.push(request) }, terminate: vi.fn() }
  const frame = new AsyncBusFrame(() => port, onOverload)
  const reply = (request = sent.at(-1)!, vehicles = [vehicle]) => port.onmessage?.({ data: {
    id: request.id, epoch: request.epoch, simMs: request.simMs, vehicles,
  } } as MessageEvent<BusWorkerReply>)
  return { sent, port, frame, reply }
}

describe('background bus frame', () => {
  it('preserves the worker epoch and queues when only LRT windows change', () => {
    const { sent, frame, reply } = setup()
    frame.sample(data, 1000, 0)
    const epoch = sent[0].epoch
    reply()
    for (let i = 1; i <= 20; i++) {
      const updated = { ...data, busRoutes: [...data.busRoutes], lrtWindows: [{
        version: 1 as const, start: i * 60_000, end: i * 60_000 + 120_000, vehicles: [], service: [],
      }] }
      frame.sample(updated, 1000 + i * 100, i * 100)
      expect(sent.at(-1)?.epoch).toBe(epoch)
      expect(sent.at(-1)?.reset).toBe(false)
      expect(sent.at(-1)?.routes).toBeUndefined()
      expect(sent.at(-1)?.stops).toBeUndefined()
      reply()
    }
  })

  it('reports a lower rate after sustained backlog growth without resetting the fleet', () => {
    const onOverload = vi.fn()
    const { frame, sent, port, reply } = setup(onOverload)
    frame.sample(data, 0, 0, {}, 60); reply()
    frame.sample(data, 0, 1, {}, 60)
    for (let at = 200; at <= 1400; at += 200) {
      frame.sample(data, at * 60, at, {}, 60)
      const request = sent.at(-1)!
      port.onmessage?.(new MessageEvent<BusWorkerReply>('message', {
        data: { id: request.id, epoch: request.epoch, simMs: at * 25, vehicles: [vehicle] },
      }))
      frame.sample(data, at * 60 + 60, at + 1, {}, 60)
    }
    expect(onOverload).toHaveBeenCalledOnce()
    expect(onOverload).toHaveBeenCalledWith(30)
    expect(sent.every(request => !request.reset)).toBe(true)
  })

  it('continues an unfinished target without another clock tick, and holds while paused', () => {
    const { frame, port, sent, reply } = setup()
    frame.sample(data, 1000, 0, {}, 60); reply()
    frame.sample(data, 49000, 800, {}, 60)
    const delayed = sent.at(-1)!
    expect(delayed.simMs).toBe(48000)
    port.onmessage?.(new MessageEvent<BusWorkerReply>('message', { data: { id: delayed.id, epoch: delayed.epoch, simMs: 9000, vehicles: [vehicle] } }))
    frame.sample(data, 49000, 833, {}, 60)
    expect(sent.at(-1)?.simMs).toBe(48000)
    expect(sent.at(-1)?.id).not.toBe(delayed.id)
    expect(sent.at(-1)?.reset).toBe(false)
    frame.sample(data, 49000, 850, {}, 0)
    const running = sent.at(-1)!
    port.onmessage?.(new MessageEvent<BusWorkerReply>('message', { data: { id: running.id, epoch: running.epoch, simMs: 17000, vehicles: [vehicle] } }))
    frame.sample(data, 49000, 866, {}, 0)
    expect(sent.at(-1)?.hold).toBe(true)
    const hold = sent.at(-1)!
    port.onmessage?.(new MessageEvent<BusWorkerReply>('message', { data: { id: hold.id, epoch: hold.epoch, simMs: 17000, vehicles: [vehicle] } }))
    for (let at = 900; at <= 1100; at += 33) frame.sample(data, 49000, at, {}, 0)
    expect(sent.at(-1)).toBe(hold)
    frame.sample(data, 49000, 1133, {}, 60)
    expect(sent.at(-1)?.id).not.toBe(hold.id)
    expect(sent.at(-1)?.hold).toBeUndefined()
  })

  it('refreshes a paused view once after panning, without resetting traffic', () => {
    const { sent, frame, reply } = setup()
    frame.sample(data, 1000, 0, {}, 0); reply()
    const view = { bounds: [113.53, 22.18, 113.55, 22.2] as [number, number, number, number] }
    frame.sample(data, 1000, 33, view, 0)
    expect(sent).toHaveLength(2)
    expect(sent[1].reset).toBe(false)
    expect(sent[1].simMs).toBe(1000)
    reply()
    frame.sample(data, 1000, 66, { ...view, bounds: [...view.bounds] }, 0)
    expect(sent).toHaveLength(2)
  })
  it('batches fast playback on aligned steps and asks the worker to hold a paused fleet', () => {
    const { sent, frame, reply } = setup()
    frame.sample(data, 1000, 0, undefined, 60); reply()
    frame.sample(data, 5000, 67, undefined, 60)
    expect(sent).toHaveLength(1)
    frame.sample(data, 9000, 134, undefined, 60)
    expect(sent.at(-1)?.simMs).toBe(8000)
    reply()
    frame.sample(data, 11000, 168, undefined, 0)
    expect(sent.at(-1)?.simMs).toBe(11000)
    expect(sent.at(-1)?.hold).toBe(true)
    reply()
    frame.sample(data, 11000, 200, undefined, 0)
    expect(sent).toHaveLength(3)
  })

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

  it('forwards junction spans attached after the routes once, and restarts the queues with them', () => {
    const { sent, frame, reply } = setup()
    const late = { id: '2', roadProfile: { version: 1, geometryKey: '2:00000000', fetchedAtUtc: '', sections: [] } } as unknown as BusRoute
    const lateData = { busRoutes: [late], busStops: [] as BusStop[] }
    frame.sample(lateData, 1000, 0)
    expect(sent[0].routes).toHaveLength(1)
    expect(sent[0].junctions).toBeUndefined()
    reply()
    const spans = [{ id: 'j1', start: 0.1, end: 0.2 }]
    late.roadProfile!.junctions = spans
    frame.sample(lateData, 1100, 100)
    expect(sent.at(-1)?.routes).toBeUndefined()
    expect(sent.at(-1)?.junctions).toEqual([[sent[0].routeKeys![0], spans]])
    expect(sent.at(-1)?.reset).toBe(true)
    reply()
    frame.sample(lateData, 1200, 200)
    expect(sent.at(-1)?.junctions).toBeUndefined()
    expect(sent.at(-1)?.reset).toBe(false)
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
