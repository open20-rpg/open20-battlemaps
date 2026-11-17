import { type BrushStroke, type Vec2 } from "../model/types"

/**
 * The cave, water and material brushes paint a grid of cells with
 * fixed stamps — pixel circles of whole cells — rather than smooth circles.
 * Caves and water use 64 px cells (a quarter tile), materials 128 px ones
 * (half a tile). This is that grid and those stamps.
 */

/** Cells per tile of caves and water (64 px cells at 256 px per tile). */
export const CELLS_PER_TILE = 4
/** Cells per tile of materials (material meshes: 128 px cells). */
export const MATERIAL_CELLS_PER_TILE = 2

/** The brush sizes offered (UI 0–4): stamp diameters in cells. */
export const STAMP_CELLS = [3, 4, 5, 6, 11] as const

/**
 * The material brush's sizes (UI 0–4): the first five of the same stamp
 * table, which the material brush uses as is (the cave brush skips two).
 */
export const MATERIAL_STAMP_CELLS = [3, 4, 5, 6, 7] as const

/** A stamp's radius in tiles (what a stroke stores). */
export const stampRadius = (cells: number, cpt: number = CELLS_PER_TILE): number =>
  cells / (2 * cpt)

/** The stamp (diameter in cells) a stroke of `radius` tiles paints with. */
export const stampOf = (radius: number, cpt: number = CELLS_PER_TILE): number =>
  Math.max(1, Math.round(radius * 2 * cpt))

/** UI brush size (0–4) → stroke radius in tiles. */
export const brushRadius = (index: number): number =>
  stampRadius(STAMP_CELLS[Math.min(STAMP_CELLS.length - 1, Math.max(0, Math.round(index)))])

/** The brush cursor's radius in tiles: (index + 1) × 64 px. */
export const brushCursorRadius = (index: number): number =>
  (Math.max(0, Math.round(index)) + 1) / CELLS_PER_TILE

/** Material brush size (0–4) → stroke radius in tiles. */
export const materialBrushRadius = (index: number): number =>
  stampRadius(
    MATERIAL_STAMP_CELLS[Math.min(MATERIAL_STAMP_CELLS.length - 1, Math.max(0, Math.round(index)))],
    MATERIAL_CELLS_PER_TILE,
  )

/** The material brush cursor's radius in tiles: (index + 1) × 128 px. */
export const materialCursorRadius = (index: number): number =>
  (Math.max(0, Math.round(index)) + 1) / MATERIAL_CELLS_PER_TILE

/** How far apart (tiles) a stroke's stamps land: a stamp lands every 32 px moved. */
export const STAMP_SPACING = 0.5 / CELLS_PER_TILE

/** Offsets (in cells) of a stamp's cells from its center, pixel-circle shaped. */
function stampOffsets(n: number): [number, number][] {
  // Odd stamps center on a cell, even ones on a grid corner.
  const r = n / 2 - 0.1
  const out: [number, number][] = []
  const half = Math.ceil(n / 2)
  for (let j = -half; j <= half; j++) {
    for (let i = -half; i <= half; i++) {
      const cx = n % 2 === 1 ? i : i + 0.5
      const cy = n % 2 === 1 ? j : j + 0.5
      if (Math.hypot(cx, cy) <= r) out.push([cx, cy])
    }
  }
  return out
}

/**
 * A w × h grid of cells (row-major) starting at cell (ox, oy) of the map's
 * grid: its cell (i, j) spans tiles [(ox + i)/cpt, (ox + i + 1)/cpt), with
 * `cpt` cells per tile (CELLS_PER_TILE when absent).
 */
export interface CellGrid {
  w: number
  h: number
  ox: number
  oy: number
  cells: Uint8Array
  cpt?: number
}

const cptOf = (grid: Pick<CellGrid, "cpt">): number => grid.cpt ?? CELLS_PER_TILE

/** A grid over the whole map, `cpt` cells per tile. */
export const emptyGrid = (
  wTiles: number,
  hTiles: number,
  cpt: number = CELLS_PER_TILE,
): CellGrid => {
  const w = Math.max(1, Math.ceil(wTiles * cpt))
  const h = Math.max(1, Math.ceil(hTiles * cpt))
  return { w, h, ox: 0, oy: 0, cells: new Uint8Array(w * h), cpt }
}

/** A grid just covering a stroke (and its stamps), with a cell of margin. */
export function strokeGrid(stroke: BrushStroke): CellGrid {
  const r = stroke.radius * CELLS_PER_TILE + 2
  const xs = stroke.points.map((p) => p.x * CELLS_PER_TILE)
  const ys = stroke.points.map((p) => p.y * CELLS_PER_TILE)
  const ox = Math.floor(Math.min(...xs) - r)
  const oy = Math.floor(Math.min(...ys) - r)
  const w = Math.ceil(Math.max(...xs) + r) - ox + 1
  const h = Math.ceil(Math.max(...ys) + r) - oy + 1
  return { w, h, ox, oy, cells: new Uint8Array(w * h) }
}

/** Stamp an `n`-cell stamp at map point `p`, setting its cells to `value`. */
export function stamp(grid: CellGrid, p: Vec2, n: number, value: number): void {
  const fx = p.x * cptOf(grid)
  const fy = p.y * cptOf(grid)
  // Odd: the cell under the point (its center); even: the nearest corner.
  const cx = n % 2 === 1 ? Math.floor(fx + 1e-6) + 0.5 : Math.round(fx)
  const cy = n % 2 === 1 ? Math.floor(fy + 1e-6) + 0.5 : Math.round(fy)
  for (const [dx, dy] of stampOffsets(n)) {
    const i = Math.floor(cx + dx) - grid.ox
    const j = Math.floor(cy + dy) - grid.oy
    if (i >= 0 && j >= 0 && i < grid.w && j < grid.h) grid.cells[j * grid.w + i] = value
  }
}

/** Stamp along a stroke: at each point and every STAMP_SPACING between. */
export function stampStroke(grid: CellGrid, stroke: BrushStroke, value: number): void {
  const n = stampOf(stroke.radius, cptOf(grid))
  const pts = stroke.points
  if (pts.length === 0) return
  stamp(grid, pts[0], n, value)
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]
    const b = pts[k]
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STAMP_SPACING))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      stamp(grid, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, n, value)
    }
  }
}

/** The grid as a field (1 inside, 0 outside) for isoContours. */
export const gridField = (grid: CellGrid): Float32Array => Float32Array.from(grid.cells)

/**
 * A point of a contour from isoContours over `grid` (its cells, samples at
 * cell centers) in map tiles — jittered (caveJitter-style functions take
 * map-grid cell coordinates, so shared edges jitter alike).
 */
export const cellsToMap = (
  grid: Pick<CellGrid, "ox" | "oy" | "cpt">,
  p: Vec2,
  jitter: (q: Vec2) => Vec2 = (q) => q,
): Vec2 => {
  const q = jitter({ x: p.x + grid.ox, y: p.y + grid.oy })
  return { x: q.x / cptOf(grid), y: q.y / cptOf(grid) }
}
