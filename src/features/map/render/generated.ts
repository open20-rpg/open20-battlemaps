import { BufferImageSource, Texture } from "pixi.js"
import { inkLineAlpha, rippleDashAlpha } from "./waterStyle"

/**
 * Procedural textures generated once on a canvas: the soft round brush stamp
 * (terrain/material blending), the default light falloff and water's ink
 * line and ripple strokes.
 */

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

/** Default light shape when a light has no style texture. */
export function lightFalloffTexture(): Texture {
  // Quadratic falloff, (1 − d)², like Godot's default light texture.
  lightFalloff ??= radialTexture([
    [0, 1],
    [0.25, 0.56],
    [0.5, 0.25],
    [0.75, 0.06],
    [1, 0],
  ])
  return lightFalloff
}

/** A white line texture (premultiplied) from an alpha map, repeating along its length. */
function alphaLineTexture(alpha: Uint8Array, width: number, height: number): Texture {
  const rgba = new Uint8Array(width * height * 4)
  alpha.forEach((a, k) => rgba.set([a, a, a, a], k * 4))
  const texture = new Texture({
    source: new BufferImageSource({
      resource: rgba,
      width,
      height,
      alphaMode: "premultiplied-alpha",
      scaleMode: "linear",
    }),
  })
  texture.source.style.addressMode = "repeat"
  return texture
}

let waterInk: Texture | undefined
let waterRipple: Texture[] | undefined

/** Water's shore line: a hand-inked stroke of varying weight (tint it with the ink color). */
export function waterInkTexture(): Texture {
  waterInk ??= alphaLineTexture(inkLineAlpha(1024, 32, 1275), 1024, 32)
  return waterInk
}

/** Water's ripples: loose short strokes; `row` picks one of two layouts so rows don't match. */
export function waterRippleTexture(row: 0 | 1): Texture {
  // Sparse, so they read as a few pen flicks and not as a dashed ring.
  waterRipple ??= [
    [1321, 0.22],
    [805, 0.14],
  ].map(([seed, fill]) => alphaLineTexture(rippleDashAlpha(2048, 16, seed, fill), 2048, 16))
  return waterRipple[row]
}
