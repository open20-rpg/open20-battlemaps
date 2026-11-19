/**
 * A slider's touch drag with a precise mode (phones and tablets: a finger
 * covers the thumb and can't place it to the pixel). It starts as usual,
 * the value under the finger; moving the finger up away from the slider,
 * or keeping it (almost) still a moment, switches to the precise mode, where
 * the value moves at {@link FINE_RATIO} of the finger's speed from where it was.
 */

/** Fraction of the finger's speed the value moves at in the precise mode. */
export const FINE_RATIO = 0.1
/** Px the finger goes up from where it pressed to switch to the precise mode. */
export const UP_TO_FINE_PX = 24
/** Px the finger may wander and still count as still. */
export const STILL_PX = 6
/** How long (ms) the finger stays still to switch to the precise mode. */
export const STILL_MS = 450

export interface SliderRange {
  min: number
  max: number
  step: number
}

/** `v` on the slider's steps, within its range. */
export function snapToStep(v: number, { min, max, step }: SliderRange): number {
  const snapped = step > 0 ? min + Math.round((v - min) / step) * step : v
  // Clean the float noise the steps add (0.1 × 3 = 0.30000000000000004).
  const clean = Number(snapped.toPrecision(12))
  return Math.min(max, Math.max(min, clean))
}

/** The value under the finger at `x` on a track spanning `left`…`left + width`. */
export function valueAt(x: number, track: { left: number; width: number }, r: SliderRange): number {
  const t = track.width > 0 ? (x - track.left) / track.width : 0
  return snapToStep(r.min + t * (r.max - r.min), r)
}

/**
 * The value in the precise mode: the one it had when the mode started
 * (`anchor`), moved by the finger's travel since at {@link FINE_RATIO}.
 */
export function fineValueAt(
  x: number,
  anchor: { x: number; value: number },
  width: number,
  r: SliderRange,
): number {
  const perPx = width > 0 ? (r.max - r.min) / width : 0
  return snapToStep(anchor.value + (x - anchor.x) * perPx * FINE_RATIO, r)
}

/** Whether the finger went up far enough from where it pressed. */
export const wentUp = (startY: number, y: number): boolean => startY - y >= UP_TO_FINE_PX

/** Whether the finger moved off the spot it was resting on. */
export const leftSpot = (spot: { x: number; y: number }, p: { x: number; y: number }): boolean =>
  Math.hypot(p.x - spot.x, p.y - spot.y) > STILL_PX

/**
 * Which thumb a press at value `v` takes: the nearest; on a tie (thumbs on
 * the same spot) the one it can move, the upper going up, the lower down.
 */
export function nearestThumb(values: readonly number[], v: number): number {
  let best = 0
  for (let i = 1; i < values.length; i++) {
    const d = Math.abs(values[i] - v)
    const bestD = Math.abs(values[best] - v)
    if (d < bestD || (d === bestD && v > values[i])) best = i
  }
  return best
}

/** `values` with thumb `i` at `v`, kept between its neighbours (thumbs never cross). */
export function withThumb(values: readonly number[], i: number, v: number): number[] {
  const lo = i > 0 ? values[i - 1] : -Infinity
  const hi = i < values.length - 1 ? values[i + 1] : Infinity
  return values.map((x, j) => (j === i ? Math.min(hi, Math.max(lo, v)) : x))
}
