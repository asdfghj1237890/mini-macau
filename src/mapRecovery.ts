// Rebuilding a broken context on every render makes the failure worse. Coalesce
// the error storm, allow one automatic rebuild, and cancel work for removed maps.
export function createMapRecovery({
  canRetry, suspend, retry, fail,
}: {
  canRetry: () => boolean
  suspend: () => void
  retry: () => void
  fail: (reason: string) => void
}) {
  let disposed = false
  let pending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    report(reason: string) {
      if (disposed || pending) return
      pending = true
      suspend()
      if (canRetry()) timer = setTimeout(retry, 250)
      else fail(reason)
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
    },
  }
}

export function isShaderRenderError(message: string): boolean {
  return /(?:Could not compile (?:fragment|vertex) shader:|Program failed to link:)/.test(message)
}
