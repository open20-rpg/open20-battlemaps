import { type Graphics } from "pixi.js"
import { hexToPixiColor } from "../../../lib/colors"
import { BASE_TILE_PX, tileSizeForZoom } from "./viewport"

export type GridStyle = "dashes" | "dotted" | "narrow" | "thick"

export interface GridParams {
  style: GridStyle
  color: string
}

/**
 * Each style's "natural" screen px size at 100% zoom, scaling proportionally
 * with zoom above {@link FLOOR_ZOOM} (so it renders for free via the world
 * container's transform — this is a per-tile-unit constant, zoom cancels
 * out). Dotted's is a diameter; the rest are stroke widths.
 */
const NATURAL_PX_AT_100: Record<GridStyle, number> = {
  thick: 1,
  narrow: 0.5,
  dashes: 0.5,
  dotted: 1.25,
}

/** Below this zoom (inclusive), every style freezes at a fixed screen size. */
const FLOOR_ZOOM = 200
/** Fixed screen px size every style's floor uses (stroke width or dot side). */
const FLOOR_PX = 2
/** Above this zoom, dotted draws circles; at/below it, squares (same as dashes' floor). */
const DOTTED_CIRCLE_ZOOM = 250

/** Floor-mode alpha multiplier (relative to the chosen color's own alpha). */
const FLOOR_ALPHA_FACTOR: Record<"thick" | "narrow" | "dotted", number> = {
  thick: 1,
  narrow: 0.5,
  dotted: 1,
}
/** Dashes' floor alpha is half of dotted's floor alpha (both are full here). */
const DASHES_FLOOR_ALPHA_FACTOR = FLOOR_ALPHA_FACTOR.dotted * 0.5

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

function squaresAlong(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  spacing: number,
  halfSide: number,
): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)
  const ux = dx / length
  const uy = dy / length
  for (let pos = 0; pos <= length; pos += spacing) {
    const px = x1 + ux * pos
    const py = y1 + uy * pos
    g.rect(px - halfSide, py - halfSide, halfSide * 2, halfSide * 2)
  }
}

function strokeLines(
  g: Graphics,
  mapWidth: number,
  mapHeight: number,
  width: number,
  color: number,
  alpha: number,
): void {
  for (let x = 0; x <= mapWidth; x++) g.moveTo(x, 0).lineTo(x, mapHeight)
  for (let y = 0; y <= mapHeight; y++) g.moveTo(0, y).lineTo(mapWidth, y)
  g.stroke({ width, color, alpha, cap: "butt" })
}

function dashLines(
  g: Graphics,
  mapWidth: number,
  mapHeight: number,
  width: number,
  color: number,
  alpha: number,
): void {
  const dashLen = width * 4
  const gapLen = width * 3
  for (let x = 0; x <= mapWidth; x++) strokeDashed(g, x, 0, x, mapHeight, dashLen, gapLen)
  for (let y = 0; y <= mapHeight; y++) strokeDashed(g, 0, y, mapWidth, y, dashLen, gapLen)
  g.stroke({ width, color, alpha, cap: "butt" })
}

function circleDots(
  g: Graphics,
  mapWidth: number,
  mapHeight: number,
  diameter: number,
  color: number,
  alpha: number,
): void {
  const spacing = diameter * 2.5
  const radius = diameter / 2
  for (let x = 0; x <= mapWidth; x++) dotsAlong(g, x, 0, x, mapHeight, spacing, radius)
  for (let y = 0; y <= mapHeight; y++) dotsAlong(g, 0, y, mapWidth, y, spacing, radius)
  g.fill({ color, alpha })
}

function squareDots(
  g: Graphics,
  mapWidth: number,
  mapHeight: number,
  side: number,
  color: number,
  alpha: number,
): void {
  const spacing = side * 2.5
  const halfSide = side / 2
  for (let x = 0; x <= mapWidth; x++) squaresAlong(g, x, 0, x, mapHeight, spacing, halfSide)
  for (let y = 0; y <= mapHeight; y++) squaresAlong(g, 0, y, mapWidth, y, spacing, halfSide)
  g.fill({ color, alpha })
}

/**
 * (Re)builds the tile grid into `g`, entirely in map-local (tile) units. `g`
 * lives inside the world container, whose scale equals the current tile
 * size, so above {@link FLOOR_ZOOM} every style's world-unit size is a
 * per-zoom-independent constant (the zoom term cancels out) — no rebuild
 * needed on zoom changes there. At/below {@link FLOOR_ZOOM} every style
 * freezes at a fixed on-screen size instead of continuing to shrink, which —
 * since the world transform only scales linearly — requires recomputing the
 * world-unit size from the current `zoom` and rebuilding whenever it changes.
 */
export function drawGrid(
  g: Graphics,
  mapWidth: number,
  mapHeight: number,
  params: GridParams,
  zoom: number,
): void {
  g.clear()

  const { color, alpha } = hexToPixiColor(params.color)
  const tileSize = tileSizeForZoom(zoom)
  const isFloor = zoom <= FLOOR_ZOOM
  const naturalWidth = (px: GridStyle) => NATURAL_PX_AT_100[px] / BASE_TILE_PX

  if (params.style === "thick" || params.style === "narrow") {
    const width = isFloor ? FLOOR_PX / tileSize : naturalWidth(params.style)
    const factor = isFloor ? FLOOR_ALPHA_FACTOR[params.style] : 1
    strokeLines(g, mapWidth, mapHeight, width, color, alpha * factor)
    return
  }

  if (params.style === "dashes") {
    if (!isFloor) {
      dashLines(g, mapWidth, mapHeight, naturalWidth("dashes"), color, alpha)
    } else {
      squareDots(
        g,
        mapWidth,
        mapHeight,
        FLOOR_PX / tileSize,
        color,
        alpha * DASHES_FLOOR_ALPHA_FACTOR,
      )
    }
    return
  }

  // dotted
  if (zoom > DOTTED_CIRCLE_ZOOM) {
    circleDots(g, mapWidth, mapHeight, naturalWidth("dotted"), color, alpha)
  } else if (!isFloor) {
    squareDots(
      g,
      mapWidth,
      mapHeight,
      naturalWidth("dotted"),
      color,
      alpha * FLOOR_ALPHA_FACTOR.dotted,
    )
  } else {
    squareDots(
      g,
      mapWidth,
      mapHeight,
      FLOOR_PX / tileSize,
      color,
      alpha * FLOOR_ALPHA_FACTOR.dotted,
    )
  }
}
