/**
 * Post-processing of the rendered map (Settings › Post-processing): color
 * adjustments and a look filter, applied to the map on screen and in PNG
 * exports. An app preference, not part of any map file.
 */
export type PostFilter = "none" | "grayscale" | "sepia" | "threshold" | "invert"

export interface PostProcess {
  /** -1..1, added to every channel. */
  brightness: number
  /** -1..1: 0 unchanged, -1 flat gray, 1 doubled around mid-gray. */
  contrast: number
  /** -1..1: -1 gray, 1 twice as saturated. */
  saturation: number
  filter: PostFilter
  /** Luminance cut for the "threshold" filter (black below, white above), 0..1. */
  threshold: number
}

export const POST_FILTERS: readonly PostFilter[] = [
  "none",
  "grayscale",
  "sepia",
  "threshold",
  "invert",
]

export const DEFAULT_POST_PROCESS: PostProcess = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  filter: "none",
  threshold: 0.5,
}

/** Whether `pp` leaves colors untouched (then no filter pass is needed at all). */
export function isNeutral(pp: PostProcess): boolean {
  return pp.brightness === 0 && pp.contrast === 0 && pp.saturation === 0 && pp.filter === "none"
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * One color (channels 0..1) through `pp`: brightness, contrast, saturation,
 * then the filter. The GPU version (render/postProcessFilter.ts) mirrors this.
 */
export function applyPostProcess(
  rgb: readonly [number, number, number],
  pp: PostProcess,
): [number, number, number] {
  let [r, g, b] = rgb.map((c) => (c - 0.5) * (1 + pp.contrast) + 0.5 + pp.brightness)
  const y = luma(r, g, b)
  ;[r, g, b] = [r, g, b].map((c) => y + (c - y) * (1 + pp.saturation))
  switch (pp.filter) {
    case "grayscale": {
      const v = luma(r, g, b)
      ;[r, g, b] = [v, v, v]
      break
    }
    case "sepia":
      ;[r, g, b] = [
        0.393 * r + 0.769 * g + 0.189 * b,
        0.349 * r + 0.686 * g + 0.168 * b,
        0.272 * r + 0.534 * g + 0.131 * b,
      ]
      break
    case "threshold": {
      const v = luma(r, g, b) >= pp.threshold ? 1 : 0
      ;[r, g, b] = [v, v, v]
      break
    }
    case "invert":
      ;[r, g, b] = [1 - r, 1 - g, 1 - b]
      break
  }
  return [clamp01(r), clamp01(g), clamp01(b)]
}

/** The valid fields of an untrusted post-process patch (others dropped, numbers clamped). */
export function normalizePostProcessPatch(patch: Record<string, unknown>): Partial<PostProcess> {
  const out: Partial<PostProcess> = {}
  const unit = (v: unknown, min: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(1, v)) : undefined
  for (const key of ["brightness", "contrast", "saturation"] as const) {
    const v = unit(patch[key], -1)
    if (v !== undefined) out[key] = v
  }
  const threshold = unit(patch.threshold, 0)
  if (threshold !== undefined) out.threshold = threshold
  const filter = POST_FILTERS.find((f) => f === patch.filter)
  if (filter) out.filter = filter
  return out
}
