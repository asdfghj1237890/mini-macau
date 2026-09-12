import { describe, expect, it } from 'vitest'
import { BusPlaybackRate } from './busPlaybackRate'

describe('traffic playback rate', () => {
  it('reduces a persistently overloaded rate, without cascading while the worker catches up', () => {
    const rate = new BusPlaybackRate()
    expect(rate.sample(0, 0, 0, 60)).toBeUndefined()
    expect(rate.sample(30000, 16000, 500, 60)).toBeUndefined()
    expect(rate.sample(60000, 32000, 1000, 60)).toBe(30)
    expect(rate.sample(63000, 40000, 1100, 30)).toBeUndefined()
    expect(rate.sample(93000, 88000, 2100, 30)).toBeUndefined()
    expect(rate.sample(123000, 120000, 3100, 30)).toBeUndefined()
  })

  it('leaves a stable buffer, transient slow reply, pause and realtime alone', () => {
    const rate = new BusPlaybackRate()
    rate.sample(30000, 0, 0, 60)
    expect(rate.sample(90000, 60000, 1000, 60)).toBeUndefined()
    expect(rate.sample(93000, 62000, 1050, 60)).toBeUndefined()
    expect(rate.sample(150000, 148000, 2000, 60)).toBeUndefined()
    expect(rate.sample(150000, 148000, 2100, 0)).toBeUndefined()
    expect(rate.sample(250000, 149000, 3100, 1)).toBeUndefined()
    rate.clear()
    expect(rate.sample(3600000, 3600000, 4000, 60)).toBeUndefined()
  })
})
