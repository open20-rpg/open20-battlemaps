import {
  BlurFilter,
  ColorMatrixFilter,
  Container,
  defaultFilterVert,
  Filter,
  GlProgram,
  Graphics,
  Matrix,
  MeshSimple,
  NoiseFilter,
  Sprite,
  Text,
  UniformGroup,
  type Texture,
} from "pixi.js"
import {
  type BlendMode,
  type BuiltinFilter,
  type EntityStyle,
  type ParticleEmitter,
  type Primitive,
  type UniformSpec,
} from "@open20/battlemaps-sdk"
import { hexToPixiColor } from "../../../lib/colors"
import { type MapEntity } from "../model/types"
import { type RenderEnv } from "./entities"

/**
 * Drawing for extensions: their primitives (own entities, overlays, drafts,
 * grids), their styles over core entities, and their shaders. Extensions
 * never touch Pixi: they hand data over and this file builds the objects,
 * so a broken or hostile primitive can only draw wrong, never reach out.
 *
 * What extensions contribute comes through a bridge (set by
 * features/extensions) so the renderer doesn't depend on the extension host.
 */
export interface ExtensionRenderBridge {
  /** Changes whenever a style, shader or primitive an extension gave changed. */
  rev(): number
  /** What an extension entity draws; undefined while it's being asked for. */
  primitivesFor(entity: MapEntity): Primitive[] | undefined
  /** Style over an entity's normal look (null: none). */
  styleFor(entity: MapEntity): EntityStyle | null
  /** A wall/path style an extension draws instead of the core look (undefined: pending). */
  overrideFor(entity: MapEntity): Primitive[] | null | undefined
  /** Overlays, the tool draft and fog for a level. */
  overlays(level: string | null): Primitive[]
  /** Post-process shaders, in order. */
  postShaders(): { id: string; uniforms?: Record<string, unknown> }[]
  shader(
    id: string,
  ): { fragment: string; uniforms?: Record<string, UniformSpec>; animated?: boolean } | null
  /** Image URL of an extension's runtime/bundled asset (`ext:<id>/<name>`). */
  imageUrl(assetId: string): string | null
  /** What an extension's grid kind draws over a map of this size (undefined: pending). */
  gridPrimitives(kind: string, width: number, height: number): Primitive[] | undefined
  /** Particle emitters showing on a level (toggled ones only while on). */
  particles(level: string | null): ParticleEmitter[]
  /** Whether something animated is showing (the canvas redraws continuously). */
  animating(): boolean
  /** Called when asked-for results arrived (the scene redraws what waited). */
  subscribe(listener: () => void): () => void
}

let bridge: ExtensionRenderBridge | null = null

export function setExtensionRenderBridge(b: ExtensionRenderBridge | null): void {
  bridge = b
}

export const extensionBridge = (): ExtensionRenderBridge | null => bridge

const color = (hex: string | undefined, fallback = 0xffffff): number =>
  hex ? hexToPixiColor(hex).color : fallback
const num = (v: unknown, f: number) => (typeof v === "number" && Number.isFinite(v) ? v : f)
const BLENDS: Record<BlendMode, string> = {
  normal: "normal",
  add: "add",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
}

/** What drawing primitives needs from the scene: textures, and telling it something waits. */
export type PrimitiveEnv = Pick<RenderEnv, "tex" | "image" | "pending">

/** Texture of an asset id: a pack asset, or an extension's (`ext:` ids). */
function textureOf(id: string, env: PrimitiveEnv): Texture | undefined {
  if (id.startsWith("ext:")) {
    const url = bridge?.imageUrl(id)
    return url ? env.image(url) : undefined
  }
  return env.tex(id)
}

/** Build the display objects for primitives (content space: x mirrored). */
export function drawPrimitives(
  list: readonly Primitive[],
  env: PrimitiveEnv,
  depth = 0,
): Container {
  const root = new Container()
  if (depth > 8) return root
  let g: Graphics | null = null
  const graphics = () => {
    if (!g) {
      g = new Graphics()
      root.addChild(g)
    }
    return g
  }
  for (const p of list) {
    switch (p?.type) {
      case "path": {
        if (!Array.isArray(p.points) || p.points.length < 2) break
        const pts = p.points.flatMap((q) => [-num(q.x, 0), num(q.y, 0)])
        const shape = graphics().poly(pts, !!p.closed)
        const tex = p.texture ? textureOf(p.texture, env) : undefined
        if (p.closed && tex) {
          const s = num(p.textureScale, 1) / tex.width
          shape.fill({ texture: tex, matrix: new Matrix().scale(s, s), alpha: num(p.fillAlpha, 1) })
        } else if (p.closed && p.fill)
          shape.fill({ color: color(p.fill), alpha: num(p.fillAlpha, 1) })
        if (p.stroke)
          shape.stroke({
            width: num(p.strokeWidth, 0.05),
            color: color(p.stroke),
            alpha: num(p.strokeAlpha, 1),
          })
        g = null
        break
      }
      case "circle": {
        const c = graphics().circle(
          -num(p.center?.x, 0),
          num(p.center?.y, 0),
          Math.max(0, num(p.radius, 0.5)),
        )
        if (p.fill) c.fill({ color: color(p.fill), alpha: num(p.fillAlpha, 1) })
        if (p.stroke) c.stroke({ width: num(p.strokeWidth, 0.05), color: color(p.stroke) })
        g = null
        break
      }
      case "sprite": {
        const tex = textureOf(String(p.asset), env)
        if (!tex) {
          env.pending?.()
          break
        }
        const s = new Sprite(tex)
        s.anchor.set(0.5)
        const w = num(p.width, tex.width / 256)
        s.width = w
        s.height = p.height !== undefined ? num(p.height, w) : (w * tex.height) / tex.width
        s.position.set(-num(p.position?.x, 0), num(p.position?.y, 0))
        s.rotation = (num(p.rotation, 0) * Math.PI) / 180
        if (p.tint) s.tint = color(p.tint)
        s.alpha = num(p.alpha, 1)
        root.addChild(s)
        g = null
        break
      }
      case "text": {
        // Drawn big and scaled down: text at a fraction of a pixel is mush.
        const base = 64
        const t = new Text({
          text: String(p.text).slice(0, 500),
          style: {
            fontFamily: p.font || "sans-serif",
            fontSize: base,
            fill: color(p.color, 0xffffff),
            align: p.align ?? "left",
          },
        })
        const k = Math.max(0.01, num(p.size, 0.5)) / base
        t.scale.set(k)
        t.anchor.set(p.align === "center" ? 0.5 : p.align === "right" ? 1 : 0, 0.5)
        t.position.set(-num(p.position?.x, 0), num(p.position?.y, 0))
        t.rotation = (num(p.rotation, 0) * Math.PI) / 180
        root.addChild(t)
        g = null
        break
      }
      case "mesh": {
        const tex = textureOf(String(p.texture), env)
        if (!tex) {
          env.pending?.()
          break
        }
        const n = Math.min(p.vertices?.length ?? 0, p.uvs?.length ?? 0, 65_000)
        if (n < 3) break
        const mesh = new MeshSimple({
          texture: tex,
          vertices: new Float32Array(
            p.vertices.slice(0, n).flatMap((v) => [-num(v.x, 0), num(v.y, 0)]),
          ),
          uvs: new Float32Array(p.uvs.slice(0, n).flatMap((v) => [num(v.x, 0), num(v.y, 0)])),
          indices: new Uint32Array(
            (p.indices ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < n),
          ),
        })
        if (p.tint) mesh.tint = color(p.tint)
        root.addChild(mesh)
        g = null
        break
      }
      case "group": {
        const child = drawPrimitives(Array.isArray(p.children) ? p.children : [], env, depth + 1)
        child.alpha = num(p.alpha, 1)
        if (p.style) applyStyle(child, p.style)
        root.addChild(child)
        g = null
        break
      }
    }
  }
  return root
}

// -- styles ---------------------------------------------------------------------

const SIMPLE_FRAGMENTS: Record<"pixelate" | "vignette" | "outline" | "glow", string> = {
  pixelate: `
uniform float uSize;
uniform vec4 uInputSize;
void main(void) {
  vec2 px = uInputSize.zw * max(uSize, 1.0);
  finalColor = texture(uTexture, floor(vTextureCoord / px) * px + px * 0.5);
}`,
  vignette: `
uniform float uAmount;
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  float d = distance(vTextureCoord, vec2(0.5));
  finalColor = vec4(c.rgb * (1.0 - smoothstep(0.3, 0.75, d) * uAmount), c.a);
}`,
  outline: `
uniform vec3 uColor;
uniform float uWidth;
uniform vec4 uInputSize;
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  float a = 0.0;
  for (int i = 0; i < 8; i++) {
    float ang = float(i) * 0.785398;
    a = max(a, texture(uTexture, vTextureCoord + vec2(cos(ang), sin(ang)) * uInputSize.zw * uWidth).a);
  }
  finalColor = mix(vec4(uColor, 1.0) * a, c, c.a);
}`,
  glow: `
uniform vec3 uColor;
uniform float uWidth;
uniform vec4 uInputSize;
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  float a = 0.0;
  for (int i = 0; i < 16; i++) {
    float ang = float(i) * 0.392699;
    for (int r = 1; r <= 3; r++)
      a += texture(uTexture, vTextureCoord + vec2(cos(ang), sin(ang)) * uInputSize.zw * uWidth * float(r) / 3.0).a;
  }
  a = clamp(a / 24.0, 0.0, 1.0);
  finalColor = mix(vec4(uColor, 1.0) * a * 0.8, c, c.a);
}`,
}

const HEADER = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
`

const programs = new Map<string, GlProgram>()

function program(key: string, body: string): GlProgram {
  let p = programs.get(key)
  if (!p) {
    p = GlProgram.from({ vertex: defaultFilterVert, fragment: HEADER + body, name: key })
    programs.set(key, p)
  }
  return p
}

const rgb = (hex: string): number[] => {
  const c = color(hex)
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]
}

function builtinFilter(f: BuiltinFilter): Filter | null {
  switch (f?.type) {
    case "blur":
      return new BlurFilter({ strength: Math.min(num(f.strength, 2), 40) })
    case "noise":
      return new NoiseFilter({ noise: Math.min(Math.max(num(f.amount, 0.3), 0), 1) })
    case "grayscale": {
      const m = new ColorMatrixFilter()
      m.greyscale(1, false)
      return m
    }
    case "sepia": {
      const m = new ColorMatrixFilter()
      m.sepia(false)
      return m
    }
    case "pixelate":
      return new Filter({
        glProgram: program("ext-pixelate", SIMPLE_FRAGMENTS.pixelate),
        resources: {
          u: new UniformGroup({ uSize: { value: Math.min(num(f.size, 4), 64), type: "f32" } }),
        },
      })
    case "vignette":
      return new Filter({
        glProgram: program("ext-vignette", SIMPLE_FRAGMENTS.vignette),
        resources: {
          u: new UniformGroup({ uAmount: { value: Math.min(num(f.amount, 0.6), 1), type: "f32" } }),
        },
      })
    case "outline":
    case "glow":
      return new Filter({
        glProgram: program(`ext-${f.type}`, SIMPLE_FRAGMENTS[f.type]),
        padding: Math.ceil(num(f.type === "outline" ? f.width : f.strength, 2) * 3),
        resources: {
          u: new UniformGroup({
            uColor: { value: new Float32Array(rgb(f.color)), type: "vec3<f32>" },
            uWidth: {
              value: Math.min(num(f.type === "outline" ? f.width : f.strength, 2), 16),
              type: "f32",
            },
          }),
        },
      })
  }
  return null
}

/** Uniform values typed for Pixi from a shader's declared uniforms. */
function uniformGroup(
  specs: Record<string, UniformSpec> | undefined,
  values: Record<string, unknown> | undefined,
): UniformGroup {
  const u: Record<string, { value: number | Float32Array; type: string }> = {
    uTime: { value: performance.now() / 1000, type: "f32" },
  }
  for (const [name, spec] of Object.entries(specs ?? {})) {
    if (!/^u[A-Z]\w{0,30}$/.test(name)) continue
    const v = values?.[name] ?? spec.default
    switch (spec.type) {
      case "float":
        u[name] = { value: num(v, 0), type: "f32" }
        break
      case "bool":
        u[name] = { value: v ? 1 : 0, type: "f32" }
        break
      case "color":
        u[name] = {
          value: new Float32Array(rgb(typeof v === "string" ? v : "#ffffff")),
          type: "vec3<f32>",
        }
        break
      case "vec2":
      case "vec3":
      case "vec4": {
        const n = Number(spec.type[3])
        const arr = Array.isArray(v) ? v.slice(0, n).map((x) => num(x, 0)) : []
        while (arr.length < n) arr.push(0)
        u[name] = { value: new Float32Array(arr), type: `vec${n}<f32>` }
        break
      }
    }
  }
  return new UniformGroup(u as never)
}

/** The GLSL declarations of a shader's uniforms (the extension writes only `main`). */
export function uniformDeclarations(specs: Record<string, UniformSpec> | undefined): string {
  const lines = ["uniform float uTime;", "uniform vec4 uInputSize;"]
  for (const [name, spec] of Object.entries(specs ?? {})) {
    if (!/^u[A-Z]\w{0,30}$/.test(name)) continue
    const type =
      spec.type === "color"
        ? "vec3"
        : spec.type === "bool"
          ? "float"
          : spec.type === "texture"
            ? null
            : spec.type
    if (type) lines.push(`uniform ${type} ${name};`)
  }
  return lines.join("\n") + "\n"
}

/** Filters made from extension shaders: the time uniform of each animated one ticks. */
const animated = new Set<UniformGroup>()

export function tickShaders(seconds: number): void {
  for (const u of animated) (u.uniforms as Record<string, number>).uTime = seconds
}

/** A filter running an extension's shader, or null if it doesn't compile. */
export function shaderFilter(id: string, values?: Record<string, unknown>): Filter | null {
  const spec = bridge?.shader(id)
  if (!spec) return null
  try {
    const glProgram = program(
      `ext-shader:${id}:${spec.fragment.length}`,
      uniformDeclarations(spec.uniforms) + spec.fragment,
    )
    const group = uniformGroup(spec.uniforms, values)
    if (spec.animated) animated.add(group)
    return new Filter({ glProgram, resources: { u: group } })
  } catch {
    return null
  }
}

/** Apply an extension's style to a drawn entity view. */
export function applyStyle(view: Container, style: EntityStyle): void {
  if (style.hidden) {
    view.visible = false
    return
  }
  if (style.tint) view.tint = color(style.tint)
  if (style.alpha !== undefined) view.alpha *= Math.max(0, Math.min(1, num(style.alpha, 1)))
  if (style.blend && BLENDS[style.blend]) view.blendMode = BLENDS[style.blend] as never
  if (style.offset) {
    view.position.x -= num(style.offset.x, 0)
    view.position.y += num(style.offset.y, 0)
  }
  if (style.scale !== undefined)
    view.scale.set(view.scale.x * num(style.scale, 1), view.scale.y * num(style.scale, 1))
  const filters: Filter[] = []
  const adjust =
    style.hue !== undefined ||
    style.saturation !== undefined ||
    style.brightness !== undefined ||
    style.contrast !== undefined
  if (adjust) {
    const m = new ColorMatrixFilter()
    if (style.hue) m.hue(num(style.hue, 0), true)
    if (style.saturation !== undefined) m.saturate(num(style.saturation, 1) - 1, true)
    if (style.brightness !== undefined) m.brightness(num(style.brightness, 1), true)
    if (style.contrast !== undefined) m.contrast(num(style.contrast, 1) - 1, true)
    filters.push(m)
  }
  for (const f of (style.filters ?? []).slice(0, 4)) {
    const made = builtinFilter(f)
    if (made) filters.push(made)
  }
  if (style.shader) {
    const made = shaderFilter(style.shader.id, style.shader.uniforms)
    if (made) filters.push(made)
  }
  if (filters.length) view.filters = [...(view.filters ?? []), ...filters]
}

/** The renderer of extension entity kinds (`ext:<id>/<type>`). */
export function extensionEntityRenderer(entity: MapEntity, env: RenderEnv): Container {
  const prims = bridge?.primitivesFor(entity)
  if (!prims) {
    env.pending?.()
    return new Container()
  }
  return drawPrimitives(prims, env)
}
