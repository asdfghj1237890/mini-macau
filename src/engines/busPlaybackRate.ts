/** Reduce the selected rate only when checked traffic persistently loses
 * ground. A falling backlog is recovery, and must not trigger another cut. */
export class BusPlaybackRate {
  private speed = NaN
  private since = NaN
  private lag = 0

  clear(): void { this.speed = this.since = NaN; this.lag = 0 }

  sample(clockMs: number, computedMs: number, now: number, speed: number): number | undefined {
    if (!Number.isFinite(computedMs) || speed <= 1) { this.clear(); return }
    const lag = Math.max(0, clockMs - computedMs)
    if (speed !== this.speed) {
      this.speed = speed; this.since = now; this.lag = lag
      return
    }
    if (now - this.since < 1000) return
    const growing = lag - this.lag > speed * 100
    this.since = now; this.lag = lag
    if (lag <= Math.max(4000, speed * 350) || !growing) return
    return [30, 10, 5, 2, 1].find(rate => rate < speed)
  }
}
