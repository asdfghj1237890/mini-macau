import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMapRecovery, isShaderRenderError } from './mapRecovery'

describe('map recovery', () => {
  afterEach(() => vi.useRealTimers())

  it('suspends immediately and coalesces a shader error storm into one retry', () => {
    vi.useFakeTimers()
    const suspend = vi.fn(), retry = vi.fn(), fail = vi.fn()
    const recovery = createMapRecovery({ canRetry: () => true, suspend, retry, fail })
    for (let i = 0; i < 441; i++) recovery.report('Could not compile fragment shader: null')
    expect(suspend).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(fail).not.toHaveBeenCalled()
  })

  it('stops automatically retrying when the replacement context also fails', () => {
    vi.useFakeTimers()
    const retry = vi.fn(), fail = vi.fn(), suspend = vi.fn()
    const recovery = createMapRecovery({ canRetry: () => false, suspend, retry, fail })
    recovery.report('WebGL context lost')
    recovery.report('another error')
    vi.runAllTimers()
    expect(suspend).toHaveBeenCalledTimes(1)
    expect(fail).toHaveBeenCalledExactlyOnceWith('WebGL context lost')
    expect(retry).not.toHaveBeenCalled()
  })

  it('never revives an unmounted map', () => {
    vi.useFakeTimers()
    const retry = vi.fn(), fail = vi.fn(), suspend = vi.fn()
    const recovery = createMapRecovery({ canRetry: () => true, suspend, retry, fail })
    recovery.report('WebGL context lost')
    recovery.dispose()
    recovery.report('late event')
    vi.runAllTimers()
    expect(retry).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
    expect(suspend).toHaveBeenCalledTimes(1)
  })

  it('does not treat unrelated network or application errors as shader failures', () => {
    expect(isShaderRenderError('Uncaught Error: Could not compile fragment shader: null')).toBe(true)
    expect(isShaderRenderError('Could not compile vertex shader: syntax error')).toBe(true)
    expect(isShaderRenderError('Program failed to link: log')).toBe(true)
    expect(isShaderRenderError('AJAXError: Failed to fetch')).toBe(false)
    expect(isShaderRenderError('Source already exists')).toBe(false)
  })
})
