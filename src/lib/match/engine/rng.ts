/**
 * Deterministic seeded RNG (mulberry32 over an FNV-1a string hash). The
 * whole engine draws only from this - never Math.random - so the same
 * matchSeed and the same snapshot always reproduce the identical match,
 * which is what makes results stable across refreshes and makes bugs
 * reproducible.
 */
export class SeededRandom {
  private state: number

  constructor(seed: string) {
    let hash = 0x811c9dc5
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    this.state = hash >>> 0
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform in [min, max]. */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1 - Number.EPSILON))
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]
  }

  /** Picks by relative weight - used for "which player did this happen to". */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    const total = items.reduce((sum, item) => sum + Math.max(0, weightOf(item)), 0)
    if (total <= 0) return this.pick(items)
    let roll = this.next() * total
    for (const item of items) {
      roll -= Math.max(0, weightOf(item))
      if (roll <= 0) return item
    }
    return items[items.length - 1]
  }
}

export function generateMatchSeed(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
