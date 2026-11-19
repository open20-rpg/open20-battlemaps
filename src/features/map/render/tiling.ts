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
