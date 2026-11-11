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

/** Side of the square blocks the export renders one per frame (px). */
export const EXPORT_TILE_PX = 2048

/** The export's block grid: `[x, y, width, height]` per block, row by row. */
export function exportTiles(
  width: number,
  height: number,
  tile = EXPORT_TILE_PX,
): [number, number, number, number][] {
  const out: [number, number, number, number][] = []
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      out.push([x, y, Math.min(tile, width - x), Math.min(tile, height - y)])
    }
  }
  return out
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/**
 * Render the open map to PNG bytes without freezing the UI: the image is
 * rendered in {@link EXPORT_TILE_PX} blocks, one per frame (each block reads
 * back only its own pixels), assembled on a 2D canvas and encoded with the
 * asynchronous `toBlob`. The live scene content joins the export stage only
 * for the instant each block renders, so the editor never shows it missing.
 */
export async function renderMapPng(opts: ExportOptions): Promise<Uint8Array> {
  const map = useMapStore.getState().map
  if (!map || !active) throw new Error("No map is open")
  const { renderer, scene } = active
  const ppt = exportPxPerTile(opts.pxPerTile, map.width, map.height)
  const width = map.width * ppt
  const height = map.height * ppt

  const bg = new Graphics().rect(0, 0, map.width, map.height).fill({ color: 0x2b2b2f })
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
  const out = document.createElement("canvas")
  out.width = width
  out.height = height
  const ctx = out.getContext("2d")
  if (!ctx) throw new Error("No 2D canvas")

  const stage = new Container()
  // Mimic the world container: mirrored x with the origin at the map's
  // top-right corner (see viewport.ts), scaled to `ppt`.
  stage.scale.set(-ppt, ppt)
  try {
    for (const [x, y, w, h] of exportTiles(width, height)) {
      const rt = RenderTexture.create({ width: w, height: h })
      stage.position.set(width - x, -y)
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
      const block = renderer.extract.canvas({ target: rt }) as HTMLCanvasElement
      ctx.drawImage(block, x, y)
      rt.destroy(true)
      await nextFrame()
    }
  } finally {
    stage.destroy()
    bg.destroy()
    grid.destroy()
  }
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("PNG encoding failed")
  return new Uint8Array(await blob.arrayBuffer())
}
