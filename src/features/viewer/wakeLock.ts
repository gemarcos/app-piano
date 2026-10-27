// Owner: viewer. Keeps the phone screen awake while the score plays (practising at the piano).
type Lock = { release: () => Promise<void> }
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Lock> } }

export class ScreenWakeLock {
  private lock: Lock | null = null

  /** Requests the lock; `wanted` is checked again when the request resolves. */
  async acquire(wanted: () => boolean): Promise<void> {
    try {
      const nav = navigator as WakeLockNavigator
      if (!nav.wakeLock || this.lock || document.visibilityState !== 'visible') return
      const lock = await nav.wakeLock.request('screen')
      if (wanted() && !this.lock) this.lock = lock
      else void lock.release().catch(() => {})
    } catch {
      // not allowed or unsupported
    }
  }

  release() {
    const lock = this.lock
    this.lock = null
    if (lock) void lock.release().catch(() => {})
  }
}
