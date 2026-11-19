import {
  Container,
  GlProgram,
  Matrix,
  Mesh,
  MeshGeometry,
  RenderTexture,
  Shader,
  Sprite,
  Texture,
  UniformGroup,
  type Renderer,
} from "pixi.js"
import { TERRAIN_BLEND_STEP, TERRAIN_SLOTS, type TexelRect } from "./splat"

/**
 * The whole terrain in one pass, with the splat formula (see splat.ts):
 *
 *  - Height blending (Smooth Blending off): each slot's height is its
 *    texture's alpha × its weight. The highest slot wins; only slots within
 *    `blend_step` (0.04) of it mix in, weighted by how far above the cut they
 *    are. Forgotten Adventures' terrain textures store a height map in their
 *    alpha (stones high, mortar low), which is what makes paths keep their
 *    width and break up stone by stone. No noise.
 *  - Smooth Blending: colors mixed linearly by weight (normalized only with
 *    more than 4 slots).
 *
 * It's a mesh covering the map drawn straight to the screen (not a filter,
 * which first renders to an offscreen texture), and each pixel only samples
 * the slots that have weight there — usually one or two of the eight. A slot
 * without weight only matters when every height is under `blend_step` (then
 * it mixes in at height 0), and is sampled just in that case. Weights come
 * packed three per RGB texture (one channel per slot, see painted.ts);
 * textures tile at 256 px per tile from the map's origin.
 */
const vertex = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`

const SLOTS = Array.from({ length: TERRAIN_SLOTS }, (_, i) => i)
const SCALES = ["uScale01.xy", "uScale01.zw", "uScale23.xy", "uScale23.zw"].concat([
  "uScale45.xy",
  "uScale45.zw",
  "uScale67.xy",
  "uScale67.zw",
])

/**
 * Sample slot i into t[i] when `cond` holds. Samplers can't be indexed by a
 * loop variable, so this is unrolled; gradients come from outside the branch
 * (implicit ones are undefined in non-uniform control flow).
 */
const sampleSlots = (cond: (i: number) => string) =>
  SLOTS.map(
    (i) => `  if (${cond(i)}) {
    highp vec2 s = ${SCALES[i]};
    t[${i}] = straight(textureGrad(uT${i}, p * s, dpx * s, dpy * s));
  }`,
  ).join("\n")

const fragment = /* glsl */ `#version 300 es
in vec2 vUV;
out vec4 finalColor;

${SLOTS.map((i) => `uniform sampler2D uT${i};`).join("\n")}
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

// Straight color and alpha of a premultiplied sample.
vec4 straight(vec4 c) {
  return vec4(c.a > 0.0 ? c.rgb / c.a : c.rgb, c.a);
}

void main(void) {
  highp vec2 p = vUV * uMapSize;
  highp vec2 dpx = dFdx(p);
  highp vec2 dpy = dFdy(p);
  vec3 w012 = texture(uW0, vUV).rgb;
  vec3 w345 = texture(uW1, vUV).rgb;
  vec3 w67 = texture(uW2, vUV).rgb;
  // Slots without a texture take no part at all (not even at height 0).
  float e[8];
  e[0] = uEnabledA.x; e[1] = uEnabledA.y; e[2] = uEnabledA.z; e[3] = uEnabledA.w;
  e[4] = uEnabledB.x; e[5] = uEnabledB.y; e[6] = uEnabledB.z; e[7] = uEnabledB.w;
  float w[8];
  w[0] = w012.r; w[1] = w012.g; w[2] = w012.b;
  w[3] = w345.r; w[4] = w345.g; w[5] = w345.b;
  w[6] = w67.r; w[7] = w67.g;
  vec4 t[8];
  for (int i = 0; i < 8; i++) t[i] = vec4(0.0);
${sampleSlots((i) => `e[${i}] > 0.5 && w[${i}] > 0.0`)}

  vec3 albedo = vec3(0.0);
  if (uSmooth > 0.5) {
    float sum = 0.0;
    for (int i = 0; i < 8; i++) {
      albedo += t[i].rgb * w[i] * e[i];
      sum += w[i] * e[i];
    }
    if (uSlots > 4.5 && sum > 0.0) albedo /= sum;
  } else {
    float top = 0.0;
    for (int i = 0; i < 8; i++) top = max(top, t[i].a * w[i]);
    float start = top - ${TERRAIN_BLEND_STEP.toFixed(4)};
    // Every height under the step: the weightless slots mix in too.
    if (start < 0.0) {
${sampleSlots((i) => `e[${i}] > 0.5 && w[${i}] <= 0.0`)}
    }
    float sum = 0.0;
    for (int i = 0; i < 8; i++) {
      float s = max(t[i].a * w[i] - start, 0.0) * e[i];
      albedo += t[i].rgb * s;
      sum += s;
    }
    albedo = sum > 0.0 ? albedo / sum : vec3(0.0);
  }
  finalColor = vec4(albedo, 1.0);
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

function terrainShader(slots: TerrainSlots): Shader {
  program ??= GlProgram.from({
    vertex,
    fragment,
    name: "terrain",
    preferredFragmentPrecision: "highp",
  })
  const enabled = Array.from({ length: TERRAIN_SLOTS }, (_, i) => (slots.textures[i] ? 1 : 0))
  // Textures are sampled at world px / texture size, with 256 world px per tile.
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
  return new Shader({ glProgram: program, resources })
}

/**
 * A quad over the map's area `u0..u1 × v0..v1` (fractions of the map; the
 * weights' texel x runs with the document's world x, which is content x, so
 * the map spans content x from −width to 0).
 */
function quad(map: { width: number; height: number }, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
  const x = (u: number) => -map.width + u * map.width
  const y = (v: number) => v * map.height
  return {
    positions: new Float32Array([x(u0), y(v0), x(u1), y(v0), x(u1), y(v1), x(u0), y(v1)]),
    uvs: new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]),
  }
}

const sameMatrix = (a: Matrix, b: Matrix) =>
  a.a === b.a && a.b === b.b && a.c === b.c && a.d === b.d && a.tx === b.tx && a.ty === b.ty

/**
 * The terrain as drawn on screen. The blend runs per pixel over the whole
 * map, which is far too much to redo on every frame (a cursor moving, an
 * object dragged): it's kept in a screen-sized texture instead, redrawn
 * whole only when the view moves or the terrain is rebuilt, and — while a
 * stroke paints — just over the painted rectangle. Exports draw the mesh
 * itself (their scale and target aren't the screen's).
 */
export class TerrainLayer {
  readonly view = new Container()
  private readonly shader: Shader
  private readonly mesh: Mesh<MeshGeometry, Shader>
  private readonly patch: Mesh<MeshGeometry, Shader>
  private readonly sprite = new Sprite()
  private rt: RenderTexture | null = null
  private drawnWith = new Matrix(0, 0, 0, 0)
  private dirty: TexelRect | "all" | null = "all"
  private direct = false

  constructor(
    private readonly renderer: Renderer,
    private readonly slots: TerrainSlots,
    /** The weights' size in texels. */
    private readonly texels: { width: number; height: number },
    /** The screen cache's resolution, a fraction of the canvas' (Settings › Performance). */
    private readonly cacheScale = 1,
  ) {
    this.shader = terrainShader(slots)
    const full = quad(slots.map)
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3])
    this.mesh = new Mesh({ geometry: new MeshGeometry({ ...full, indices }), shader: this.shader })
    this.patch = new Mesh({
      geometry: new MeshGeometry({ ...full, indices: indices.slice() }),
      shader: this.shader,
    })
    this.view.addChild(this.sprite)
  }

  /** Painted texels changed: redraw them (or everything, without a rect). */
  invalidate(rect?: TexelRect): void {
    if (this.dirty === "all") return
    if (!rect) {
      this.dirty = "all"
      return
    }
    const d = this.dirty
    this.dirty = d
      ? {
          x0: Math.min(d.x0, rect.x0),
          y0: Math.min(d.y0, rect.y0),
          x1: Math.max(d.x1, rect.x1),
          y1: Math.max(d.y1, rect.y1),
        }
      : rect
  }

  /** Draw the mesh itself (exports) instead of the screen cache. */
  setDirect(on: boolean): void {
    if (on === this.direct) return
    this.direct = on
    this.view.removeChildren()
    this.view.addChild(on ? this.mesh : this.sprite)
    if (!on) this.dirty = "all"
  }

  /** Bring the screen cache up to date; call before each render of the screen. */
  prerender(): void {
    if (this.direct || !this.view.parent) return
    const { width, height } = this.renderer.screen
    const resolution = this.renderer.resolution * this.cacheScale
    if (
      !this.rt ||
      this.rt.width !== width ||
      this.rt.height !== height ||
      this.rt.source.resolution !== resolution
    ) {
      this.rt?.destroy(true)
      this.rt = RenderTexture.create({ width, height, resolution })
      this.sprite.texture = this.rt
      this.dirty = "all"
    }
    // Content space → screen, as this frame will draw it.
    const toScreen = this.view.parent.getGlobalTransform(new Matrix())
    if (!sameMatrix(toScreen, this.drawnWith)) {
      this.drawnWith = toScreen.clone()
      this.dirty = "all"
    }
    // The cache covers the screen: undo the view's transform for the sprite.
    this.sprite.setFromMatrix(toScreen.clone().invert())
    if (!this.dirty) return
    if (this.dirty === "all") {
      this.renderer.render({
        container: this.mesh,
        target: this.rt,
        clear: true,
        transform: toScreen,
      })
    } else {
      const { width: tw, height: th } = this.texels
      const r = this.dirty
      const q = quad(
        this.slots.map,
        Math.max(0, r.x0) / tw,
        Math.max(0, r.y0) / th,
        Math.min(tw, r.x1) / tw,
        Math.min(th, r.y1) / th,
      )
      this.patch.geometry.positions = q.positions
      this.patch.geometry.uvs = q.uvs
      this.renderer.render({
        container: this.patch,
        target: this.rt,
        clear: false,
        transform: toScreen,
      })
    }
    this.dirty = null
  }

  destroy(): void {
    this.view.destroy({ children: true })
    if (this.direct) this.sprite.destroy()
    else this.mesh.destroy()
    this.patch.destroy()
    this.shader.destroy()
    this.rt?.destroy(true)
  }
}
