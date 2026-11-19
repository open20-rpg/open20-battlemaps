import { Container, Graphics, RenderTexture, type Renderer } from "pixi.js"
import { useMapStore } from "../../../stores/mapStore"
import { getToolParams } from "../../../stores/toolsStore"
import { SAMPLE_MAX_PX, supportsTransparency, type ExportFormat } from "../exportFormat"
import { drawGrid, type GridStyle } from "./grid"
import { MAP_GROUND_COLOR, type ExportLook, type MapScene } from "./scene"
import { AssetCache, assetCache } from "./assets"
import { PRESET_SETTINGS, type GraphicsPreset } from "../../../lib/renderPerformance"

/**
 * PNG export. The live canvas registers its renderer + scene here so the
 * export reuses the exact same display tree (no second renderer, no texture
 * reloads), re-rendered off-screen at the requested resolution.
 */
let active: { renderer: Renderer; scene: MapScene } | null = null

export function setActiveRenderer(value: { renderer: Renderer; scene: MapScene } | null): void {
  active = value
}

/** GPU-safe cap on the exported image's longest side. */
export const EXPORT_MAX_PX = 8192

/** Pixels per tile actually used for `requested`, capped so the image fits {@link EXPORT_MAX_PX}. */
export function exportPxPerTile(requested: number, width: number, height: number): number {
  return Math.max(1, Math.min(requested, Math.floor(EXPORT_MAX_PX / Math.max(width, height))))
}

export interface ExportOptions extends ExportLook {
  pxPerTile: number
  grid: boolean
  format: ExportFormat
  /** Graphics quality the image is drawn with, whatever the screen's (Ultra by default). */
  quality: GraphicsPreset
}

/**
 * Textures at the export quality's detail, when it isn't the screen's (a
 * phone on Low loads them at half size): kept between an export's size
 * estimates and the export itself, freed by {@link releaseExportTextures}.
 */
let exportAssets: AssetCache | null = null

function texturesFor(quality: GraphicsPreset): AssetCache {
  const { textureScale: scale, mipmaps } = PRESET_SETTINGS[quality]
  const live = assetCache.textureLoading
  if (live.scale === scale && live.mipmaps === mipmaps) return assetCache
  const current = exportAssets?.textureLoading
  if (!exportAssets || current?.scale !== scale || current.mipmaps !== mipmaps) {
    exportAssets?.dispose()
    exportAssets = new AssetCache()
    exportAssets.configure({ scale, mipmaps })
  }
  return exportAssets
}

/** Free the export's own textures (the export dialog closed). */
export function releaseExportTextures(): void {
  exportAssets?.dispose()
  exportAssets = null
}

/** Longest wait for the export's textures before drawing without the missing ones. */
const SETTLE_MS = 20000

/** Wait until the scene has every texture it draws (or SETTLE_MS passed). */
async function settled(scene: MapScene): Promise<void> {
  const until = performance.now() + SETTLE_MS
  while (!scene.isComplete() && performance.now() < until) await nextFrame()
}

/** Most RGBA bytes one band carries (the export holds one band at a time). */
export const EXPORT_BAND_BYTES = 16 * 1024 * 1024

/** The export's bands: `[y, height]` per band, top to bottom, each ≤ EXPORT_BAND_BYTES. */
export function exportBands(width: number, height: number): [number, number][] {
  const rows = Math.max(1, Math.floor(EXPORT_BAND_BYTES / (width * 4)))
  const out: [number, number][] = []
  for (let y = 0; y < height; y += rows) out.push([y, Math.min(rows, height - y)])
  return out
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** Renders pixel rectangles of the export image (RGBA rows, top to bottom). */
type RenderRect = (x: number, y: number, w: number, h: number) => Uint8Array

/**
 * Run `fn` with the open map set up for export at the size `opts` asks:
 * the scene in the export's look, and a stage (ground, content, grid)
 * that renders any pixel rectangle of the image. The live scene content
 * joins the export stage only for the instant each rectangle renders, so
 * the editor never shows it missing.
 */
function withExportStage<T>(
  opts: ExportOptions,
  fn: (size: { width: number; height: number }, render: RenderRect) => Promise<T>,
): Promise<T> {
  // One at a time: a size estimate must not switch the scene's look back
  // in the middle of an export (or the other way around).
  const run = queue.then(
    () => exportStage(opts, fn),
    () => exportStage(opts, fn),
  )
  queue = run.catch(() => undefined)
  return run
}

/** The export (or estimate) running or last run; the next one waits for it. */
let queue: Promise<unknown> = Promise.resolve()

async function exportStage<T>(
  opts: ExportOptions,
  fn: (size: { width: number; height: number }, render: RenderRect) => Promise<T>,
): Promise<T> {
  const map = useMapStore.getState().map
  if (!map || !active) throw new Error("No map is open")
  const { renderer, scene } = active
  const ppt = exportPxPerTile(opts.pxPerTile, map.width, map.height)
  const width = map.width * ppt
  const height = map.height * ppt
  const transparent = opts.transparent && supportsTransparency(opts.format.kind)

  const bg = new Graphics()
  if (!transparent) bg.rect(0, 0, map.width, map.height).fill({ color: MAP_GROUND_COLOR })
  const grid = new Graphics()
  if (opts.grid) {
    const p = getToolParams("mapSettings")
    // Zoom 400 keeps the grid at its "natural" scaled size, not the screen floor.
    drawGrid(
      grid,
      map.width,
      map.height,
      { style: p.gridStyle as GridStyle, color: p.gridLineColor as string },
      400,
    )
  }
  const stage = new Container()
  // Mimic the world container: mirrored x with the origin at the map's
  // top-right corner (see viewport.ts), scaled to `ppt`.
  stage.scale.set(-ppt, ppt)
  const preset = PRESET_SETTINGS[opts.quality]
  const render: RenderRect = (x, y, w, h) => {
    const rt = RenderTexture.create({ width: w, height: h, antialias: preset.antialias })
    stage.position.set(width - x, -y)
    const content = scene.content
    const parent = content.parent
    const index = parent ? parent.getChildIndex(content) : -1
    stage.addChild(bg, content, grid)
    try {
      renderer.render({ container: stage, target: rt, clear: true })
    } finally {
      // Put the live content straight back where it was.
      stage.removeChildren()
      if (parent) parent.addChildAt(content, index)
    }
    const { pixels } = renderer.extract.pixels({ target: rt })
    rt.destroy(true)
    return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  }
  // The quality's textures (its own cache when it isn't the screen's) and
  // scene settings, every view drawn with them before the first pixel.
  const textures = texturesFor(opts.quality)
  scene.useAssets(textures)
  scene.beginExport(ppt, { ...opts, transparent })
  try {
    await settled(scene)
    return await fn({ width, height }, render)
  } finally {
    scene.useAssets(assetCache)
    scene.endExport()
    stage.destroy()
    bg.destroy()
    grid.destroy()
  }
}

/**
 * Render the open map for export without freezing the UI or holding the
 * whole image: it's rendered in full-width bands (see exportBands), one per
 * frame, and each band's RGBA rows go to `sink` (the backend, which encodes
 * them as they arrive).
 */
export async function renderMapRows(
  opts: ExportOptions,
  begin: (width: number, height: number) => Promise<void>,
  sink: (rows: Uint8Array) => Promise<void>,
): Promise<void> {
  await withExportStage(opts, async ({ width, height }, render) => {
    await begin(width, height)
    for (const [y, h] of exportBands(width, height)) {
      await sink(render(0, y, width, h))
      await nextFrame()
    }
  })
}

/** A sample of the export image to estimate its file size from. */
export interface ExportSample {
  rgba: Uint8Array
  width: number
  height: number
  /** Pixels of the whole image. */
  imagePixels: number
}

/**
 * The whole export image when it's small, else a mosaic of four crops at
 * the export's own scale (around the centers of the map's quarters), so
 * the sample's detail — and so how well it compresses — matches the image.
 */
export async function renderExportSample(opts: ExportOptions): Promise<ExportSample> {
  return withExportStage(opts, async ({ width, height }, render) => {
    const imagePixels = width * height
    if (width <= SAMPLE_MAX_PX && height <= SAMPLE_MAX_PX) {
      return { rgba: render(0, 0, width, height).slice(), width, height, imagePixels }
    }
    const cw = Math.min(width, SAMPLE_MAX_PX / 2)
    const ch = Math.min(height, SAMPLE_MAX_PX / 2)
    const rgba = new Uint8Array(cw * 2 * ch * 2 * 4)
    const row = cw * 2 * 4
    for (const [qx, qy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const x = Math.min(width - cw, Math.max(0, Math.round(((qx * 2 + 1) * width) / 4 - cw / 2)))
      const y = Math.min(height - ch, Math.max(0, Math.round(((qy * 2 + 1) * height) / 4 - ch / 2)))
      const crop = render(x, y, cw, ch)
      for (let r = 0; r < ch; r++) {
        const src = crop.subarray(r * cw * 4, (r + 1) * cw * 4)
        rgba.set(src, (qy * ch + r) * row + qx * cw * 4)
      }
    }
    return { rgba, width: cw * 2, height: ch * 2, imagePixels }
  })
}
