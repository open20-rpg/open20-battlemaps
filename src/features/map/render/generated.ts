import { Texture } from "pixi.js"

/**
 * Procedural textures generated once on a canvas: the soft round brush stamp
 * (terrain/material blending) and the default light falloff.
 */

let softBrush: Texture | undefined
let lightFalloff: Texture | undefined

function radialTexture(stops: [number, number][]): Texture {
  const size = 128
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) return Texture.WHITE
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (const [at, alpha] of stops) g.addColorStop(at, `rgba(255,255,255,${alpha})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return Texture.from(canvas)
}

/** White disc with a soft falloff toward the edge. */
export function softBrushTexture(): Texture {
  softBrush ??= radialTexture([
    [0, 1],
    [0.55, 1],
    [1, 0],
  ])
  return softBrush
}

/** Default light shape when a light has no style texture: bright core, smooth falloff. */
export function lightFalloffTexture(): Texture {
  lightFalloff ??= radialTexture([
    [0, 1],
    [0.3, 0.75],
    [0.7, 0.25],
    [1, 0],
  ])
  return lightFalloff
}
