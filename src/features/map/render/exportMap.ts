import { Container, Graphics, RenderTexture, type Renderer } from "pixi.js"
import { useMapStore } from "../../../stores/mapStore"
import { getToolParams } from "../../../stores/toolsStore"
import { drawGrid, type GridStyle } from "./grid"
import { type MapScene } from "./scene"

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

export interface ExportOptions {
  pxPerTile: number
  grid: boolean
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

/**
 * Render the open map for a PNG export without freezing the UI or holding
 * the whole image: it's rendered in full-width bands (see exportBands), one
 * per frame, and each band's RGBA rows go to `sink` (the backend, which
 * encodes them into the file as they arrive). The live scene content joins
 * the export stage only for the instant each band renders, so the editor
 * never shows it missing.
 */
export async function renderMapRows(
  opts: ExportOptions,
  begin: (width: number, height: number) => Promise<void>,
  sink: (rows: Uint8Array) => Promise<void>,
): Promise<void> {
  const map = useMapStore.getState().map
  if (!map || !active) throw new Error("No map is open")
  const { renderer, scene } = active
  const ppt = exportPxPerTile(opts.pxPerTile, map.width, map.height)
  const width = map.width * ppt
  const height = map.height * ppt
  await begin(width, height)

  const bg = new Graphics().rect(0, 0, map.width, map.height).fill({ color: 0x000000 })
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
  try {
    for (const [y, h] of exportBands(width, height)) {
      const rt = RenderTexture.create({ width, height: h })
      stage.position.set(width, -y)
      const content = scene.content
      const parent = content.parent
      const index = parent ? parent.getChildIndex(content) : -1
      stage.addChild(bg, content, grid)
      try {
        scene.forExport(ppt, () => renderer.render({ container: stage, target: rt, clear: true }))
      } finally {
        // Put the live content straight back where it was.
        stage.removeChildren()
        if (parent) parent.addChildAt(content, index)
      }
      const { pixels } = renderer.extract.pixels({ target: rt })
      rt.destroy(true)
      await sink(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength))
      await nextFrame()
    }
  } finally {
    stage.destroy()
    bg.destroy()
    grid.destroy()
  }
}
