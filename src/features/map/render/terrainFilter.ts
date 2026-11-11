import {
  Filter,
  GlProgram,
  Matrix,
  Texture,
  TextureMatrix,
  UniformGroup,
  type FilterSystem,
  type RenderSurface,
  type Sprite,
} from "pixi.js"
import { TERRAIN_BLEND_STEP, TERRAIN_SLOTS } from "./splat"

/**
 * The whole terrain in one pass, with Dungeondraft's own formula (its
 * Terrain.shader / SmoothTerrain.shader):
 *
 *  - Height blending (Smooth Blending off): each slot's height is its
 *    texture's alpha × its weight. The highest slot wins; only slots within
 *    `blend_step` (0.04) of it mix in, weighted by how far above the cut they
 *    are. Forgotten Adventures' terrain textures store a height map in their
 *    alpha (stones high, mortar low), which is what makes paths keep their
 *    width and break up stone by stone. No noise.
 *  - Smooth Blending: colors mixed linearly by weight (normalized only with
 *    more than 4 slots, as Dungeondraft does).
 *
 * Output is opaque. Weights come packed three per RGB render texture (one
 * channel per slot, see painted.ts); textures tile at 256 px per tile from
 * the map's origin. Applied to a sprite covering the map, clipped to the
 * screen like any filter.
 */
const vertex = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vMapCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform mat3 uFilterMatrix;

void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  vMapCoord = (uFilterMatrix * vec3(vTextureCoord, 1.0)).xy;
}
`

const fragment = /* glsl */ `
in vec2 vTextureCoord;
in vec2 vMapCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uT0;
uniform sampler2D uT1;
uniform sampler2D uT2;
uniform sampler2D uT3;
uniform sampler2D uT4;
uniform sampler2D uT5;
uniform sampler2D uT6;
uniform sampler2D uT7;
uniform sampler2D uW0;
uniform sampler2D uW1;
uniform sampler2D uW2;
uniform highp vec2 uMapSize;
uniform float uSmooth;
uniform float uSlots;
uniform vec4 uEnabledA;
uniform vec4 uEnabledB;
// Per slot, texture repeats per tile (256 px per tile / texture size): xy, zw.
uniform highp vec4 uScale01;
uniform highp vec4 uScale23;
uniform highp vec4 uScale45;
uniform highp vec4 uScale67;

// Straight color and alpha of slot texture t at map tile p, repeating scale times per tile.
vec4 sampleSlot(sampler2D t, highp vec2 p, highp vec2 scale) {
  vec4 c = texture(t, p * scale);
  return vec4(c.a > 0.0 ? c.rgb / c.a : c.rgb, c.a);
}

void main(void) {
  highp vec2 p = vMapCoord * uMapSize;
  vec3 w012 = texture(uW0, vMapCoord).rgb;
  vec3 w345 = texture(uW1, vMapCoord).rgb;
  vec3 w67 = texture(uW2, vMapCoord).rgb;
  // Slots without a texture take no part at all (not even at height 0).
  float e[8];
  e[0] = uEnabledA.x; e[1] = uEnabledA.y; e[2] = uEnabledA.z; e[3] = uEnabledA.w;
  e[4] = uEnabledB.x; e[5] = uEnabledB.y; e[6] = uEnabledB.z; e[7] = uEnabledB.w;
  float w[8];
  w[0] = w012.r; w[1] = w012.g; w[2] = w012.b;
  w[3] = w345.r; w[4] = w345.g; w[5] = w345.b;
  w[6] = w67.r; w[7] = w67.g;
  vec4 t[8];
  t[0] = sampleSlot(uT0, p, uScale01.xy); t[1] = sampleSlot(uT1, p, uScale01.zw);
  t[2] = sampleSlot(uT2, p, uScale23.xy); t[3] = sampleSlot(uT3, p, uScale23.zw);
  t[4] = sampleSlot(uT4, p, uScale45.xy); t[5] = sampleSlot(uT5, p, uScale45.zw);
  t[6] = sampleSlot(uT6, p, uScale67.xy); t[7] = sampleSlot(uT7, p, uScale67.zw);

  vec3 albedo = vec3(0.0);
  if (uSmooth > 0.5) {
    float sum = 0.0;
    for (int i = 0; i < 8; i++) {
      albedo += t[i].rgb * w[i] * e[i];
      sum += w[i] * e[i];
    }
    if (uSlots > 4.5 && sum > 0.0) albedo /= sum;
  } else {
    float h[8];
    float top = 0.0;
    for (int i = 0; i < 8; i++) {
      h[i] = t[i].a * w[i];
      if (e[i] > 0.5) top = max(top, h[i]);
    }
    float start = top - ${TERRAIN_BLEND_STEP.toFixed(4)};
    float sum = 0.0;
    for (int i = 0; i < 8; i++) {
      float s = max(h[i] - start, 0.0) * e[i];
      albedo += t[i].rgb * s;
      sum += s;
    }
    albedo = sum > 0.0 ? albedo / sum : vec3(0.0);
  }
  // Only where the map sprite is (the filter input), always opaque.
  finalColor = vec4(albedo, 1.0) * texture(uTexture, vTextureCoord).a;
}
`

let program: GlProgram | undefined

export interface TerrainSlots {
  /** Slot textures in slot order (missing ones are left out of the blend). */
  textures: (Texture | undefined)[]
  /** Packed weights: slots 0–2, 3–5, 6–7 in the RGB channels. */
  weights: [Texture, Texture, Texture]
  smooth: boolean
  map: { width: number; height: number }
}

export class TerrainFilter extends Filter {
  private readonly textureMatrix: TextureMatrix

  constructor(
    /** The sprite covering the map that this filter is applied to. */
    private readonly area: Sprite,
    slots: TerrainSlots,
  ) {
    const textureMatrix = new TextureMatrix(area.texture)
    program ??= GlProgram.from({
      vertex,
      fragment,
      name: "terrain",
      preferredFragmentPrecision: "highp",
    })
    const enabled = Array.from({ length: TERRAIN_SLOTS }, (_, i) => (slots.textures[i] ? 1 : 0))
    // Dungeondraft samples at world px / texture size, with 256 world px per tile.
    const scale = Array.from({ length: TERRAIN_SLOTS }, (_, i) => {
      const t = slots.textures[i]
      return t ? [256 / t.source.width, 256 / t.source.height] : [1, 1]
    }).flat()
    const vec4 = (from: number) => ({
      value: new Float32Array(scale.slice(from, from + 4)),
      type: "vec4<f32>" as const,
    })
    const resources: Record<string, unknown> = {
      terrainUniforms: new UniformGroup({
        uFilterMatrix: { value: new Matrix(), type: "mat3x3<f32>" },
        uMapSize: {
          value: new Float32Array([slots.map.width, slots.map.height]),
          type: "vec2<f32>",
        },
        uSmooth: { value: slots.smooth ? 1 : 0, type: "f32" },
        uSlots: { value: slots.textures.length, type: "f32" },
        uEnabledA: { value: new Float32Array(enabled.slice(0, 4)), type: "vec4<f32>" },
        uEnabledB: { value: new Float32Array(enabled.slice(4, 8)), type: "vec4<f32>" },
        uScale01: vec4(0),
        uScale23: vec4(4),
        uScale45: vec4(8),
        uScale67: vec4(12),
      }),
    }
    for (let i = 0; i < TERRAIN_SLOTS; i++) {
      const tex = slots.textures[i]
      if (tex) tex.source.style.addressMode = "repeat"
      resources[`uT${i}`] = (tex ?? Texture.WHITE).source
    }
    slots.weights.forEach((w, i) => (resources[`uW${i}`] = w.source))
    super({ glProgram: program, resources })
    this.textureMatrix = textureMatrix
  }

  override apply(
    filterManager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clearMode: boolean,
  ): void {
    const uniforms = (this.resources.terrainUniforms as UniformGroup).uniforms as {
      uFilterMatrix: Matrix
    }
    this.textureMatrix.update()
    filterManager
      .calculateSpriteMatrix(uniforms.uFilterMatrix, this.area)
      .prepend(this.textureMatrix.mapCoord)
    filterManager.applyFilter(this, input, output, clearMode)
  }

  override destroy(): void {
    this.textureMatrix.destroy()
    super.destroy()
  }
}
