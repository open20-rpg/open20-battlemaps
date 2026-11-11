import {
  GlProgram,
  Mesh,
  Shader,
  TilingSprite,
  UniformGroup,
  type MeshGeometry,
  type Texture,
} from "pixi.js"
import dustUrl from "../../../assets/wear/dust.webp"
import grimeUrl from "../../../assets/wear/grime.webp"
import noiseUrl from "../../../assets/wear/noise.webp"
import scratchedUrl from "../../../assets/wear/scratched.webp"
import { type BuildingWear } from "../model/types"
import { TEXTURE_PX_PER_TILE } from "./assets"

/**
 * Building wear: the grime Dungeondraft multiplies over walls (and their
 * ends), floor tiles and caves (Map Settings → Building Wear). It's laid in
 * world coordinates, one texture pixel per world pixel (two on floor tiles,
 * as Dungeondraft's Tileset shader), repeating — so its
 * blotches run across walls whatever their direction and never line up with
 * the bricks — and only ever darkens (the textures are light gray to
 * white). Ours are original 2048 px seamless textures in the same spirit
 * as Dungeondraft's four.
 */
export const BUILDING_WEAR_URLS: Record<Exclude<BuildingWear, "none">, string> = {
  dust: dustUrl,
  grime: grimeUrl,
  noise: noiseUrl,
  scratched: scratchedUrl,
}

/** Side of the wear textures, in tiles (2048 px at 256 px per tile). */
const WEAR_TILES = 2048 / TEXTURE_PX_PER_TILE

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;

out vec2 vUV;
out vec2 vWear;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform float uWearScale;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  // Mesh positions are map tiles (x mirrored): the wear is laid on the world.
  vWear = aPosition * uWearScale;
}
`

const fragment = /* glsl */ `
in vec2 vUV;
in vec2 vWear;

uniform sampler2D uTexture;
uniform sampler2D uWear;
uniform vec4 uColor;

out vec4 finalColor;

void main() {
  vec4 color = texture(uTexture, vUV);
  vec3 wear = texture(uWear, vWear).rgb;
  finalColor = vec4(color.rgb * wear, color.a) * uColor;
}
`

let program: GlProgram | undefined

/** A textured mesh (walls) with the wear multiplied over it (tint and alpha still apply). */
export function wornMesh(
  geometry: MeshGeometry,
  texture: Texture,
  wear: Texture,
): Mesh<MeshGeometry, Shader> {
  program ??= GlProgram.from({ vertex, fragment, name: "building-wear" })
  wear.source.style.addressMode = "repeat"
  const shader = new Shader({
    glProgram: program,
    resources: {
      uTexture: texture.source,
      uWear: wear.source,
      wearUniforms: new UniformGroup({
        uWearScale: { value: 1 / WEAR_TILES, type: "f32" },
      }),
    },
  })
  const mesh = new Mesh({ geometry, shader, texture })
  mesh.once("destroyed", () => shader.destroy())
  return mesh
}

/**
 * The wear over a map-covering area (floors, caves): a tiling sprite
 * covering `x, y, w, h` (content space, tiles) that multiplies what's under
 * it, anchored to the world so it lines up with the walls' wear.
 */
export function wearOverlay(
  wear: Texture,
  x: number,
  y: number,
  w: number,
  h: number,
  /** World px per texture px: 1 on walls and caves, 2 on floor tiles (as Dungeondraft). */
  stretch = 1,
): TilingSprite {
  wear.source.style.addressMode = "repeat"
  const t = new TilingSprite({ texture: wear, width: w, height: h })
  t.position.set(x, y)
  t.tileScale.set(stretch / TEXTURE_PX_PER_TILE)
  t.tilePosition.set((-x * TEXTURE_PX_PER_TILE) / stretch, (-y * TEXTURE_PX_PER_TILE) / stretch)
  t.blendMode = "multiply"
  return t
}
