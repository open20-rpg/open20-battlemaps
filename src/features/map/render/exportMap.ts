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

/** Render the open map to a PNG data URL. */
export async function renderMapPng(opts: ExportOptions): Promise<string> {
  const map = useMapStore.getState().map
  if (!map || !active) throw new Error("No map is open")
  const { renderer, scene } = active
  const ppt = exportPxPerTile(opts.pxPerTile, map.width, map.height)

  // Mimic the world container: mirrored x with the origin at the map's
  // top-right corner (see viewport.ts), scaled to `ppt`.
  const stage = new Container()
  stage.scale.set(-ppt, ppt)
  stage.position.set(map.width * ppt, 0)
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
  const content = scene.content
  const parent = content.parent
  const index = parent ? parent.getChildIndex(content) : -1
  stage.addChild(bg, content, grid)
  const rt = RenderTexture.create({ width: map.width * ppt, height: map.height * ppt })
  try {
    scene.withoutEditorAids(() => renderer.render({ container: stage, target: rt, clear: true }))
    return await renderer.extract.base64({ target: rt, format: "png" })
  } finally {
    // Put the live content back exactly where it was.
    if (parent) parent.addChildAt(content, index)
    stage.destroy({ children: true })
    rt.destroy(true)
  }
}
