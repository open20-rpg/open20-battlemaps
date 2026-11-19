import { type Application, type Container } from "pixi.js"
import { type MapScene } from "./scene"

/**
 * Settings › Performance's measurement: how long the map takes to draw on
 * this device, and how much of that each part costs (drop shadows, the
 * light map, each painted layer, each kind of object…), measured by
 * drawing the current view with that part switched off.
 *
 * A frame is timed until the GPU has finished it (reading a pixel back
 * waits for it), so the times are the device's real cost, not just the
 * time to queue the work.
 */

/** What the measurement draws with: registered by the live canvas. */
interface ProfileTarget {
  app: Application
  scene: MapScene
  /** The world container (panned to time a frame that moves the view). */
  world: Container
  grid: Container
  /** Repaint normally once measured. */
  requestRender: () => void
}

let target: ProfileTarget | null = null

export function setProfileTarget(value: ProfileTarget | null): void {
  target = value
}

export interface RenderCost {
  id: string
  /** i18n key of its name; `tool` fills its {{tool}} with a tool's name. */
  labelKey: string
  tool?: string
  /** Milliseconds per frame it adds (frame with it − frame without it). */
  ms: number
}

export interface RenderProfile {
  /** A still frame of the current view, in ms. */
  frameMs: number
  /** A frame while the view moves (screen caches redrawn), in ms. */
  moveMs: number
  /** Canvas size in CSS px and its resolution (device px per CSS px). */
  width: number
  height: number
  resolution: number
  /** Most expensive first. */
  costs: RenderCost[]
}

/** Frames timed per measurement (the median is kept: steady against hiccups). */
const FRAMES = 9

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Costs from the full frame and the frame without each part, most expensive
 * first, plus the frame's base: what no part accounts for (the ground, the
 * screen copy water needs, presenting the frame). The resolution isn't a
 * part of the picture (it scales all of them), so it doesn't count there.
 */
export function costsFrom(
  frameMs: number,
  without: readonly (Omit<RenderCost, "ms"> & { frameMs: number })[],
): RenderCost[] {
  const costs = without.map(({ frameMs: w, ...part }) => ({
    ...part,
    ms: Math.max(0, frameMs - w),
  }))
  const parts = costs.filter((c) => c.id !== "resolution").reduce((sum, c) => sum + c.ms, 0)
  const base = { id: "base", labelKey: "perf.part.base", ms: Math.max(0, frameMs - parts) }
  return [...costs, base].sort((a, b) => b.ms - a.ms)
}

export const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/**
 * Median time (ms) of {@link FRAMES} frames of `app` (after one to warm
 * up), each timed until the GPU has finished it (reading a pixel back waits
 * for it). `before(i)` runs before frame `i` (e.g. to move the view).
 */
export function timeFrames(
  app: Application,
  prerender: () => void,
  before?: (i: number) => void,
): number {
  const renderer = app.renderer
  const gl = "gl" in renderer ? (renderer.gl as WebGL2RenderingContext) : null
  const pixel = new Uint8Array(4)
  const draw = () => {
    prerender()
    app.render()
    gl?.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
  }
  draw()
  const times: number[] = []
  for (let i = 0; i < FRAMES; i++) {
    before?.(i)
    const start = performance.now()
    draw()
    times.push(performance.now() - start)
  }
  return median(times)
}

/** Measure the current view; null when no map is shown. */
export async function profileRender(): Promise<RenderProfile | null> {
  const t = target
  if (!t) return null
  const { app, scene, world, grid } = t
  const renderer = app.renderer
  const time = (before?: (i: number) => void) => timeFrames(app, () => scene.prerender(), before)

  try {
    const frameMs = time()
    // A pixel back and forth: the terrain's screen cache redraws, as when panning.
    const x = world.position.x
    const moveMs = time((i) => (world.position.x = x + (i % 2 ? 1 : -1)))
    world.position.x = x
    await nextFrame()

    const parts = [
      ...scene.profileParts(),
      ...(grid.visible
        ? [{ id: "grid", labelKey: "perf.part.grid", show: (on: boolean) => (grid.visible = on) }]
        : []),
    ]
    const without: (Omit<RenderCost, "ms"> & { frameMs: number })[] = []
    for (const { show, ...part } of parts) {
      show(false)
      try {
        without.push({ ...part, frameMs: time() })
      } finally {
        show(true)
      }
      await nextFrame()
    }

    // The resolution: the same view at 1 device pixel per CSS pixel.
    const resolution = renderer.resolution
    const { width, height } = renderer.screen
    if (resolution > 1) {
      renderer.resize(width, height, 1)
      try {
        without.push({ id: "resolution", labelKey: "perf.part.resolution", frameMs: time() })
      } finally {
        renderer.resize(width, height, resolution)
      }
    }
    return { frameMs, moveMs, width, height, resolution, costs: costsFrom(frameMs, without) }
  } finally {
    t.requestRender()
  }
}
