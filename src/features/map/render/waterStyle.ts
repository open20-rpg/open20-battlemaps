/**
 * Water's hand-inked look, after the built-in pack's ponds and pools
 * (scripts/builtin-pack: pen.py's `shape` with obj_decor's Small Pond): a
 * dark ink outline with a slow wobble in its weight, a flat fill with a soft
 * watercolor mottle, a wash darkening just inside the shore, and loose light
 * ripple strokes instead of a continuous ripple line.
 *
 * Pure pixel math: the textures are built from these in generated.ts and the
 * fill is shaded with them in painted.ts.
 */

/** The pack's ink (pen.py INK). */
export const WATER_INK = 0x261e1a

/** Small deterministic PRNG (mulberry32), so the strokes look the same on every redraw. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

/**
 * A periodic 1-D noise in [-1, 1] sampled `length` times: `knots` random
 * values smoothly interpolated, wrapping so a texture built from it repeats
 * seamlessly along the line.
 */
export function periodicNoise(length: number, knots: number, next: () => number): Float32Array {
  const values = Array.from({ length: knots }, () => next() * 2 - 1)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const f = (i / length) * knots
    const k = Math.floor(f)
    const t = smooth(f - k)
    out[i] = values[k % knots] * (1 - t) + values[(k + 1) % knots] * t
  }
  return out
}

/**
 * The shore's ink line as an alpha map (`width` along the line × `height`
 * across, row-major): a stroke centered across the texture whose weight
 * swells and thins between `min` and `max` of the height (a hand's varying
 * pressure) and whose center drifts slightly, with an antialiased edge.
 * Seamless along its length.
 */
export function inkLineAlpha(
  width: number,
  height: number,
  seed: number,
  min = 0.42,
  max = 0.62,
): Uint8Array {
  const next = rng(seed)
  const weight = periodicNoise(width, 9, next)
  const drift = periodicNoise(width, 13, next)
  const out = new Uint8Array(width * height)
  for (let x = 0; x < width; x++) {
    const half = ((min + (max - min) * (weight[x] * 0.5 + 0.5)) * height) / 2
    const center = height / 2 + drift[x] * height * 0.06
    for (let y = 0; y < height; y++) {
      const d = Math.abs(y + 0.5 - center)
      out[y * width + x] = Math.round(clamp01(half - d + 0.5) * 255)
    }
  }
  return out
}

/**
 * Ripples as an alpha map (`width` × `height`, like {@link inkLineAlpha}):
 * loose short strokes along the line, each slightly arched and tapered at
 * both ends like a quick pen flick, with gaps between them. `fill` is the
 * share of the length the strokes cover (roughly); `thickness` their peak
 * weight as a share of the height.
 */
export function rippleDashAlpha(
  width: number,
  height: number,
  seed: number,
  fill = 0.4,
  thickness = 0.5,
): Uint8Array {
  const next = rng(seed)
  const out = new Uint8Array(width * height)
  // Lay strokes out one after another; the last gap absorbs the remainder so
  // the pattern wraps without a stroke cut in half.
  const unit = height * 4
  const strokeLength = () => unit * (2 + next() * 3)
  let x = next() * unit
  for (let len = strokeLength(); x + len <= width - unit * 0.5; len = strokeLength()) {
    const arch = (next() * 2 - 1) * height * 0.18
    const offset = (next() * 2 - 1) * height * 0.12
    for (let i = Math.floor(x); i < Math.ceil(x + len); i++) {
      const t = (i + 0.5 - x) / len
      if (t <= 0 || t >= 1) continue
      const s = Math.sin(Math.PI * t)
      const half = (Math.sqrt(s) * thickness * height) / 2
      const center = height / 2 + offset + arch * (s * 2 - 1)
      for (let y = 0; y < height; y++) {
        const a = clamp01(half - Math.abs(y + 0.5 - center) + 0.5)
        const k = y * width + i
        out[k] = Math.max(out[k], Math.round(a * 255))
      }
    }
    x += len + (len * (1 - fill)) / fill
  }
  return out
}

/** A smooth hash noise in [-1, 1] over the plane, ~one blob per `period` units. */
export function mottle(x: number, y: number, period = 1.6): number {
  const hash = (ix: number, iy: number) => {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h ^= h >>> 16
    return ((h >>> 0) / 4294967295) * 2 - 1
  }
  // Two octaves, like a watercolor wash: broad patches with a finer bloom.
  let sum = 0
  let total = 0
  for (const [p, w] of [
    [period, 0.7],
    [period / 2.7, 0.3],
  ]) {
    const fx = x / p
    const fy = y / p
    const ix = Math.floor(fx)
    const iy = Math.floor(fy)
    const tx = smooth(fx - ix)
    const ty = smooth(fy - iy)
    const a = hash(ix, iy) * (1 - tx) + hash(ix + 1, iy) * tx
    const b = hash(ix, iy + 1) * (1 - tx) + hash(ix + 1, iy + 1) * tx
    sum += (a * (1 - ty) + b * ty) * w
    total += w
  }
  return sum / total
}

/** How deep (tiles) the wash inside the shore reaches, and how dark it gets at the shore. */
export const SHORE_WASH_DEPTH = 0.16
export const SHORE_WASH_STRENGTH = 0.38

/**
 * The water's color `distance` tiles from the shore at map point (x, y):
 * the ramp color `rgb` with a ±6 % watercolor mottle (pen.py's mottle) and
 * the pack's shade — darker and warmer — washed in near the shore, fading
 * out by {@link SHORE_WASH_DEPTH}.
 */
export function waterPixel(
  rgb: readonly [number, number, number],
  distance: number,
  x: number,
  y: number,
): [number, number, number] {
  const k = 1 + mottle(x, y) * 0.06
  const wash = SHORE_WASH_STRENGTH * (1 - smooth(clamp01(distance / SHORE_WASH_DEPTH)))
  // pen.py's shade(): toward (0.45, 0.38, 0.36) of the color.
  const target = [0.45, 0.38, 0.36]
  return [0, 1, 2].map((c) => {
    const v = rgb[c] * k
    return Math.round(Math.max(0, Math.min(255, v + (v * target[c] - v) * wash)))
  }) as [number, number, number]
}

/** pen.py's tint(): toward warm paper white. */
export function paperTint(rgb: readonly [number, number, number], t: number): number {
  const paper = [255, 248, 232]
  const [r, g, b] = [0, 1, 2].map((c) => Math.round(rgb[c] + (paper[c] - rgb[c]) * t))
  return (r << 16) | (g << 8) | b
}
