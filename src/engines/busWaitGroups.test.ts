import { describe, expect, it } from 'vitest'
import { closedWaitGroups, progressWaitGroups, waitsForGroup } from './busWaitGroups'

describe('bus waiting dependencies', () => {
  it('includes a crossing reservation hidden behind a second physical blocker', () => {
    const waits: Record<string, string[]> = {
      front: ['rear', 'crossing'], rear: ['front'], crossing: ['front'], queue: ['rear'],
    }
    expect(closedWaitGroups(Object.keys(waits), id => waits[id]).map(group => group.sort()))
      .toEqual([['crossing', 'front', 'rear']])
  })
  it('keeps independent cycles separate and excludes open queues', () => {
    const waits: Record<string, string[]> = {
      a: ['b'], b: ['a'], c: ['d'], d: ['c'], queue: ['a'], moving: [], following: ['moving'],
    }
    expect(closedWaitGroups(Object.keys(waits), id => waits[id]).map(group => group.sort()))
      .toEqual([['a', 'b'], ['c', 'd']])
  })
  it('does not include unavailable vehicles or mistake a self-reference for a convoy', () => {
    const waits: Record<string, string[]> = { a: ['missing', 'a'], b: ['a'] }
    expect(closedWaitGroups(Object.keys(waits), id => waits[id])).toEqual([])
  })
  it('follows a secondary reservation dependency when extending a blocked queue', () => {
    const waits: Record<string, string[]> = { queue: ['front', 'crossing'], front: ['queue'], crossing: ['member'], member: [] }
    expect(waitsForGroup('queue', new Set(['member']), id => waits[id])).toBe(true)
    expect(waitsForGroup('queue', new Set(['unrelated']), id => waits[id])).toBe(false)
  })
  it('watches a locked cycle even when it also waits on a moving branch', () => {
    const waits: Record<string, string[]> = { lockedA: ['lockedB', 'moving'], lockedB: ['lockedA'], queue: ['lockedA'], moving: [], unreported: [] }
    expect(progressWaitGroups(Object.keys(waits), id => waits[id]).map(group => group.sort()))
      .toEqual([['lockedA', 'lockedB'], ['moving'], ['unreported']])
  })
  it('watches the outlet of a draining queue without treating its tail as a deadlock', () => {
    const waits: Record<string, string[]> = { tail: ['middle'], middle: ['front'], front: [] }
    expect(progressWaitGroups(Object.keys(waits), id => waits[id])).toEqual([['front']])
  })
})
