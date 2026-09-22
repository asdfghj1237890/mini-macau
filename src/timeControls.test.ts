import { describe, it, expect } from 'vitest'
import { ignoreClockShortcut } from './timeControls'

describe('ignoreClockShortcut', () => {
  it('drops a clock key while the clock UI is off the screen', () => {
    expect(ignoreClockShortcut(true, false)).toBe(true)
  })

  it('drops it while the user is typing, locked or not', () => {
    expect(ignoreClockShortcut(false, true)).toBe(true)
    expect(ignoreClockShortcut(true, true)).toBe(true)
  })

  it('lets it through in the ordinary case', () => {
    expect(ignoreClockShortcut(false, false)).toBe(false)
  })
})
