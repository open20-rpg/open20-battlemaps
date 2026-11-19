import { type Container, type Renderer } from "pixi.js"

/**
 * Live rendering statistics for Settings › Debug's stats panel: frames drawn
 * per second, how long each took to submit, GPU draw calls, and what the
 * canvas holds. The canvas renders on demand, so an idle map draws 0 frames
 * per second: the numbers describe the frames actually drawn (while
 * panning, painting, dragging…).
 */

/** A drawn frame: when it ended and how long it took (ms, CPU side). */
interface FrameRecord {
  at: number
  ms: number
  drawCalls: number
}

/** Frames kept for the averages (a few seconds' worth). */
const KEEP = 240

const frames: FrameRecord[] = []
let drawCalls = 0
let source: { renderer: Renderer; stage: Container } | null = null

/** The live canvas registers what it draws with (null when it goes away). */
export function setStatsSource(value: { renderer: Renderer; stage: Container } | null): void {
  source = value
  frames.length = 0
  if (value) countDrawCalls(value.renderer)
}

const counted = new WeakSet<object>()

/**
 * Count the WebGL draw calls each frame issues: the context's draw methods
 * are wrapped once (a counter increment: no measurable cost).
 */
function countDrawCalls(renderer: Renderer): void {
  if (!("gl" in renderer)) return
  const gl = renderer.gl as WebGL2RenderingContext
  if (counted.has(gl)) return
  counted.add(gl)
  const methods = [
    "drawElements",
    "drawArrays",
    "drawElementsInstanced",
    "drawArraysInstanced",
  ] as const
  for (const name of methods) {
    const original = gl[name] as (...args: unknown[]) => void
    if (typeof original !== "function") continue
    Object.defineProperty(gl, name, {
      configurable: true,
      value: (...args: unknown[]) => {
        drawCalls++
        original.apply(gl, args)
      },
    })
  }
}

/** Time one screen frame: `draw` brings caches up to date and renders. */
export function recordFrame(draw: () => void): void {
  const before = drawCalls
  const start = performance.now()
  draw()
  const end = performance.now()
  frames.push({ at: end, ms: end - start, drawCalls: drawCalls - before })
  if (frames.length > KEEP) frames.splice(0, frames.length - KEEP)
}

export interface FrameStats {
  /** Frames drawn in the last second. */
  fps: number
  /** Average and worst submit time of the last second's frames, ms. */
  avgMs: number
  maxMs: number
  /** Draw calls of the last frame drawn. */
  drawCalls: number
}

/** Frame stats over the second before `now`. */
export function frameStats(records: readonly FrameRecord[], now: number): FrameStats {
  const recent = records.filter((f) => now - f.at <= 1000)
  const last = records[records.length - 1]
  return {
    fps: recent.length,
    avgMs: recent.length ? recent.reduce((s, f) => s + f.ms, 0) / recent.length : 0,
    maxMs: recent.reduce((m, f) => Math.max(m, f.ms), 0),
    drawCalls: last?.drawCalls ?? 0,
  }
}

/** Display objects in a tree (the container itself included). */
export function countNodes(root: Container): number {
  let n = 1
  for (const child of root.children) n += countNodes(child)
  return n
}

export interface RenderStats extends FrameStats {
  /** Canvas size in device pixels and its resolution (device px per CSS px). */
  width: number
  height: number
  resolution: number
  /** Display objects in the scene. */
  nodes: number
  /** Used JS heap in MB, where the webview reports it (Chromium). */
  heapMb: number | null
}

/** A snapshot of the live canvas' stats, or null when no map is shown. */
export function renderStats(): RenderStats | null {
  if (!source) return null
  const { renderer, stage } = source
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return {
    ...frameStats(frames, performance.now()),
    width: renderer.width,
    height: renderer.height,
    resolution: renderer.resolution,
    nodes: countNodes(stage),
    heapMb: memory ? memory.usedJSHeapSize / 2 ** 20 : null,
  }
}
