/**
 * How the map is rendered, traded against speed (Settings › Performance).
 * A device preference, not part of any map file: the defaults are the full
 * quality the app always drew with.
 */
export interface RenderPerformance {
  /**
   * Highest canvas resolution, device pixels per CSS pixel (the screen's
   * own when lower). Every pixel is shaded each frame: the cost grows with
   * its square.
   */
  maxResolution: number
  /** Multisampled edges (MSAA). Recreates the canvas. */
  antialias: boolean
  /**
   * Shaders compute at 32-bit precision. Off, phones and tablets compute at
   * 16 bits: faster on some, but fine detail can shimmer. Recreates the canvas.
   */
  highPrecision: boolean
  /** Asset textures loaded at this fraction of their pixels (1, 1/2, 1/4). Recreates the canvas. */
  textureScale: number
  /** Mipmapped asset textures: smoother and lighter zoomed out, more memory. Recreates the canvas. */
  mipmaps: boolean
  /** The terrain's screen cache, at this fraction of the canvas resolution. */
  terrainResolution: number
  /** Blur passes of the drop shadows (0: hard edges, no blur pass). */
  shadowBlurQuality: number
  /** Detail of the painted layers' and the light map's masks (fraction). */
  maskDetail: number
  /** Blur passes of the light map's shadow edges (0: hard edges). */
  lightBlurQuality: number
  /**
   * Water darkens with what's beneath it: needs a copy of the screen every
   * frame (a back buffer). Off, water is drawn flat. Recreates the canvas.
   */
  waterEffect: boolean
}

export const DEFAULT_RENDER_PERFORMANCE: RenderPerformance = {
  maxResolution: 2,
  antialias: true,
  highPrecision: true,
  textureScale: 1,
  mipmaps: false,
  terrainResolution: 1,
  shadowBlurQuality: 3,
  maskDetail: 1,
  lightBlurQuality: 3,
  waterEffect: true,
}

/**
 * A lighter preset for slow phones and tablets: what costs the most per
 * frame on them (pixels, the back-buffer copy, blur passes) cut down,
 * keeping the map readable.
 */
export const LIGHT_RENDER_PERFORMANCE: RenderPerformance = {
  maxResolution: 1.5,
  antialias: false,
  highPrecision: true,
  textureScale: 0.5,
  mipmaps: true,
  terrainResolution: 0.5,
  shadowBlurQuality: 1,
  maskDetail: 0.5,
  lightBlurQuality: 1,
  waterEffect: false,
}

/** Choices offered for each numeric setting. */
export const RESOLUTION_STEPS = [0.5, 0.75, 1, 1.5, 2, 3] as const
export const TEXTURE_SCALES = [1, 0.5, 0.25] as const
export const FRACTION_STEPS = [0.25, 0.5, 0.75, 1] as const
export const BLUR_QUALITIES = [0, 1, 2, 3, 4] as const

/** The settings that only take effect on a new canvas (WebGL context, loaded textures). */
const CANVAS_KEYS = [
  "antialias",
  "highPrecision",
  "textureScale",
  "mipmaps",
  "waterEffect",
] as const

/** A key that changes when the canvas has to be recreated for `perf` to apply. */
export function canvasKey(perf: RenderPerformance): string {
  return CANVAS_KEYS.map((k) => String(perf[k])).join("|")
}

/** The canvas resolution: the screen's, capped by the setting. */
export function canvasResolution(
  devicePixelRatio: number,
  perf: Pick<RenderPerformance, "maxResolution">,
): number {
  return Math.min(devicePixelRatio || 1, perf.maxResolution)
}

/** Saved settings completed with the defaults (settings saved before one existed). */
export function withPerformanceDefaults(
  saved: Partial<RenderPerformance> | undefined,
): RenderPerformance {
  return { ...DEFAULT_RENDER_PERFORMANCE, ...saved }
}
