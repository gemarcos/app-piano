// Owner: viewer. Timing helpers of the player: the audio clock as heard, and a frame loop.

/** AudioContext time being heard right now (output latency removed), for cursor sync. */
export function heardTime(ctx: AudioContext): number {
  try {
    const ts = ctx.getOutputTimestamp?.()
    if (ts && ts.contextTime && ts.performanceTime) {
      const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000
      if (t <= ctx.currentTime + 0.05) return t
    }
  } catch {
    // not supported
  }
  return ctx.currentTime - (ctx.outputLatency || 0)
}

export function sameRange(a: [number, number] | null, b: [number, number] | null): boolean {
  if (!a || !b) return a === b
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
}

/** requestAnimationFrame loop that calls `tick` every frame between start() and stop(). */
export class FrameLoop {
  private raf = 0

  constructor(private readonly tick: () => void) {}

  start() {
    if (this.raf) return
    const frame = () => {
      this.raf = requestAnimationFrame(frame)
      this.tick()
    }
    this.raf = requestAnimationFrame(frame)
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }
}
