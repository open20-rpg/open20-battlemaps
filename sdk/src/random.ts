/**
 * Seeded randomness and noise: generators that store their seed give the
 * same result every time they run (regenerating, previews, tests).
 */
import { type Rect, type Vec2 } from "./types"

export interface Rng {
  /** 0 ≤ n < 1 */
  next(): number
  range(min: number, max: number): number
  int(min: number, maxInclusive: number): number
  pick<T>(items: readonly T[]): T
  chance(p: number): boolean
  shuffle<T>(items: readonly T[]): T[]
}

/** Mulberry32: tiny, fast, good enough for maps. */
export function rng(seed: number): Rng {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const r: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    shuffle: (items) => {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
  }
  return r
}

/** A seed from text (a map name, an entity id). */
export function hashSeed(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Poisson-disk sampling (Bridson): evenly spread points at least `radius` apart. */
export function poissonDisk(area: Rect, radius: number, seed: number, tries = 30): Vec2[] {
  const r = rng(seed)
  const cell = radius / Math.SQRT2
  const cols = Math.max(1, Math.ceil(area.w / cell))
  const rows = Math.max(1, Math.ceil(area.h / cell))
  const grid: (Vec2 | undefined)[] = new Array(cols * rows)
  const out: Vec2[] = []
  const active: Vec2[] = []
  const gi = (p: Vec2) =>
    Math.floor((p.y - area.y) / cell) * cols + Math.floor((p.x - area.x) / cell)
  const fits = (p: Vec2) => {
    if (p.x < area.x || p.y < area.y || p.x >= area.x + area.w || p.y >= area.y + area.h)
      return false
    const cx = Math.floor((p.x - area.x) / cell)
    const cy = Math.floor((p.y - area.y) / cell)
    for (let y = Math.max(0, cy - 2); y <= Math.min(rows - 1, cy + 2); y++)
      for (let x = Math.max(0, cx - 2); x <= Math.min(cols - 1, cx + 2); x++) {
        const q = grid[y * cols + x]
        if (q && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < radius * radius) return false
      }
    return true
  }
  const first = { x: area.x + r.next() * area.w, y: area.y + r.next() * area.h }
  grid[gi(first)] = first
  out.push(first)
  active.push(first)
  while (active.length) {
    const i = Math.floor(r.next() * active.length)
    const base = active[i]
    let found = false
    for (let k = 0; k < tries; k++) {
      const a = r.next() * Math.PI * 2
      const d = radius * (1 + r.next())
      const p = { x: base.x + Math.cos(a) * d, y: base.y + Math.sin(a) * d }
      if (fits(p)) {
        grid[gi(p)] = p
        out.push(p)
        active.push(p)
        found = true
        break
      }
    }
    if (!found) active.splice(i, 1)
  }
  return out
}

// 2D simplex noise (Gustavson), seeded by shuffling the permutation table.
const GRAD = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export type Noise2D = (x: number, y: number) => number

/** Seeded 2D simplex noise in -1..1. */
export function simplex2(seed: number): Noise2D {
  const perm = rng(seed).shuffle(Array.from({ length: 256 }, (_, i) => i))
  const p = new Uint8Array(512)
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255]
  const F2 = 0.5 * (Math.sqrt(3) - 1)
  const G2 = (3 - Math.sqrt(3)) / 6
  return (xin, yin) => {
    const s = (xin + yin) * F2
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const t = (i + j) * G2
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    const [i1, j1] = x0 > y0 ? [1, 0] : [0, 1]
    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2
    const ii = i & 255
    const jj = j & 255
    const corner = (gi: number, x: number, y: number) => {
      const t0 = 0.5 - x * x - y * y
      if (t0 < 0) return 0
      const g = GRAD[gi % 8]
      return t0 ** 4 * (g[0] * x + g[1] * y)
    }
    const n =
      corner(p[ii + p[jj]], x0, y0) +
      corner(p[ii + i1 + p[jj + j1]], x1, y1) +
      corner(p[ii + 1 + p[jj + 1]], x2, y2)
    return 70 * n
  }
}

/** Fractal (fBm) noise: `octaves` layers of `noise`, in about -1..1. */
export function fbm(noise: Noise2D, octaves = 4, lacunarity = 2, gain = 0.5): Noise2D {
  return (x, y) => {
    let amp = 1
    let freq = 1
    let sum = 0
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq)
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return sum / norm
  }
}
