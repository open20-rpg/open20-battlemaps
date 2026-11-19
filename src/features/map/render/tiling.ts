import { type Vec2 } from "../model/types"

/**
 * Where to put a tiling texture's origin (a TilingSprite's tilePosition)
 * so it lands on the lattice anchored at `offset`, but within one repeat of
 * (0, 0). The lattice is the texture (`w` × `h`, same units as `offset`)
 * turned by `rotation` (radians, clockwise on screen) about its origin.
 *
 * The texture looks the same from any lattice point; picking the nearest
 * keeps the texture coordinates across the fill small. Large ones lose
 * precision in the GPU and the texture shows stretched texels.
 */
export function latticeOrigin(offset: Vec2, rotation: number, w: number, h: number): Vec2 {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  // In the texture's own axes, wrapped to its first repeat, then turned back.
  const a = mod(offset.x * cos + offset.y * sin, w)
  const b = mod(-offset.x * sin + offset.y * cos, h)
  return { x: a * cos - b * sin, y: a * sin + b * cos }
}

const mod = (v: number, m: number) => (m > 0 ? ((v % m) + m) % m : 0)

/** Triangles of a textured fill: content-space positions and their texture uvs. */
export interface TiledMesh {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

/** Side (tiles) of the quads a fill is cut into; see {@link tiledMesh}. */
const CELL = 4

/**
 * Quads covering the rectangle `x, y, w, h` (content space, tiles), with
 * the uvs of a texture `tw` × `th` tiles laid from `origin` and turned by
 * `rotation` (radians, clockwise on screen). The mapping only turns and
 * moves (never scales): one texture pixel is always 1/256 tile, whatever
 * the rectangle's size. Each quad's uvs are shifted by whole repeats so they
 * stay near 0 (the texture repeats, so it looks the same): far from 0 they
 * lose precision in the GPU and texels stretch.
 */
export function tiledMesh(
  rect: { x: number; y: number; w: number; h: number },
  origin: Vec2,
  rotation: number,
  tw: number,
  th: number,
): TiledMesh {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const uv = (x: number, y: number) => {
    const dx = x - origin.x
    const dy = y - origin.y
    return { u: (dx * cos + dy * sin) / tw, v: (-dx * sin + dy * cos) / th }
  }
  const cols = Math.max(1, Math.ceil(rect.w / CELL))
  const rows = Math.max(1, Math.ceil(rect.h / CELL))
  const positions = new Float32Array(cols * rows * 8)
  const uvs = new Float32Array(cols * rows * 8)
  const indices = new Uint32Array(cols * rows * 6)
  let q = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = rect.x + c * CELL
      const y0 = rect.y + r * CELL
      const x1 = Math.min(rect.x + rect.w, x0 + CELL)
      const y1 = Math.min(rect.y + rect.h, y0 + CELL)
      const corners = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ].map(([x, y]) => ({ x, y, ...uv(x, y) }))
      const su = Math.floor(Math.min(...corners.map((p) => p.u)))
      const sv = Math.floor(Math.min(...corners.map((p) => p.v)))
      corners.forEach((p, i) => {
        positions[q * 8 + i * 2] = p.x
        positions[q * 8 + i * 2 + 1] = p.y
        uvs[q * 8 + i * 2] = p.u - su
        uvs[q * 8 + i * 2 + 1] = p.v - sv
      })
      indices.set(
        [0, 1, 2, 0, 2, 3].map((i) => q * 4 + i),
        q * 6,
      )
      q++
    }
  }
  return { positions, uvs, indices }
}
