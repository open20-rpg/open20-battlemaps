import { type Graphics } from "pixi.js"
import { hexToPixiColor } from "../../../lib/colors"
import { BASE_TILE_PX } from "./viewport"

export type GridStyle = "dashes" | "dotted" | "narrow" | "thick"

export interface GridParams {
  style: GridStyle
  color: string
}

/** Each style's line width in px at 100% zoom — fixed, not user-adjustable. */
const LINE_WIDTH_PX: Record<GridStyle, number> = {
  dashes: 1,
  dotted: 2,
  narrow: 1,
  thick: 2,
}

function strokeDashed(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashLen: number,
  gapLen: number,
): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)
  const ux = dx / length
  const uy = dy / length
  for (let pos = 0; pos < length; pos += dashLen + gapLen) {
    const end = Math.min(pos + dashLen, length)
    g.moveTo(x1 + ux * pos, y1 + uy * pos).lineTo(x1 + ux * end, y1 + uy * end)
  }
}

function dotsAlong(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  spacing: number,
  radius: number,
): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)
  const ux = dx / length
  const uy = dy / length
  // regularPoly (not circle): circle()'s segment count is chosen from this
  // tiny tile-unit radius, before the world container's ~64x scale is
  // applied, so it renders as a visible diamond. An explicit 16-gon stays
  // round at any zoom regardless of the local radius.
  for (let pos = 0; pos <= length; pos += spacing) {
    g.regularPoly(x1 + ux * pos, y1 + uy * pos, radius, 16)
  }
}

/**
 * (Re)builds the tile grid into `g`, entirely in map-local (tile) units. `g`
 * lives inside the world container, whose scale equals the current tile size
 * — so line width and dash/dot spacing (derived here from the style's fixed
 * px width, in tile units) scale with zoom automatically, and this never
 * needs to rebuild on a zoom change, only when the grid's own params or the
 * map's dimensions change.
 */
export function drawGrid(
  g: Graphics,
  mapWidth: number,
  mapHeight: number,
  params: GridParams,
): void {
  g.clear()

  const width = LINE_WIDTH_PX[params.style] / BASE_TILE_PX
  const { color, alpha } = hexToPixiColor(params.color)

  if (params.style === "narrow" || params.style === "thick") {
    for (let x = 0; x <= mapWidth; x++) g.moveTo(x, 0).lineTo(x, mapHeight)
    for (let y = 0; y <= mapHeight; y++) g.moveTo(0, y).lineTo(mapWidth, y)
    g.stroke({ width, color, alpha, cap: "butt" })
    return
  }

  if (params.style === "dashes") {
    const dashLen = width * 4
    const gapLen = width * 3
    for (let x = 0; x <= mapWidth; x++) strokeDashed(g, x, 0, x, mapHeight, dashLen, gapLen)
    for (let y = 0; y <= mapHeight; y++) strokeDashed(g, 0, y, mapWidth, y, dashLen, gapLen)
    g.stroke({ width, color, alpha, cap: "butt" })
    return
  }

  // dotted
  const spacing = width * 2.5
  const radius = width / 2
  for (let x = 0; x <= mapWidth; x++) dotsAlong(g, x, 0, x, mapHeight, spacing, radius)
  for (let y = 0; y <= mapHeight; y++) dotsAlong(g, 0, y, mapWidth, y, spacing, radius)
  g.fill({ color, alpha })
}
