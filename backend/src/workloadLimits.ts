/** Process-wide reservations. A disconnect must not release a job still running. */
export class ConcurrencyLimit {
  private active = 0
  private readonly byKey = new Map<string, number>()

  constructor(private readonly total: number, private readonly perKey: number) {}

  acquire(key: string): (() => void) | null {
    const count = this.byKey.get(key) ?? 0
    if (this.active >= this.total || count >= this.perKey) return null
    this.active++
    this.byKey.set(key, count + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      const remaining = this.byKey.get(key)! - 1
      if (remaining === 0) this.byKey.delete(key)
      else this.byKey.set(key, remaining)
    }
  }
}

export const workloadLimit = new ConcurrencyLimit(4, 1)
export const connectionLimit = new ConcurrencyLimit(256, 8)
