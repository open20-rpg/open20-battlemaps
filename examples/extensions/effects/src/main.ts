import { defineExtension } from "@open20/battlemaps-sdk"

/** Old parchment: warm, desaturated, darker at the edges. */
export const PARCHMENT = `
uniform vec3 uPaper;
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  float l = dot(c.rgb, vec3(0.3, 0.59, 0.11));
  float edge = smoothstep(0.35, 0.75, distance(vTextureCoord, vec2(0.5)));
  finalColor = vec4(mix(c.rgb, uPaper * l * 1.4, 0.55) * (1.0 - edge * 0.45), c.a);
}`

/** Rippling water: moves the texture in slow waves. */
export const RIPPLE = `
void main(void) {
  vec2 uv = vTextureCoord + vec2(sin(vTextureCoord.y * 30.0 + uTime) * 0.003, 0.0);
  finalColor = texture(uTexture, uv) * vec4(0.9, 0.97, 1.05, 1.0);
}`

/** A 1×1 white PNG: the soft particle the extension registers at runtime. */
export const DOT_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
)

export default defineExtension({
  async activate(ctx) {
    const heat = new TextDecoder().decode(await ctx.file("shaders/heat.glsl"))
    await ctx.render.shader({ id: "heat", name: { es: "Calor", en: "Heat" }, target: "entity", fragment: heat, animated: true, uniforms: { uStrength: { type: "float", default: 1 } } })
    await ctx.render.shader({ id: "parchment", name: { es: "Pergamino", en: "Parchment" }, target: "post", fragment: PARCHMENT, uniforms: { uPaper: { type: "color", default: "#e8d8b0" } } })
    await ctx.render.shader({ id: "ripple", name: { es: "Ondas", en: "Ripples" }, target: "fill", fragment: RIPPLE, animated: true })

    // Lava objects shimmer (an entity shader through a style rule).
    await ctx.render.styleRule({ id: "lava-heat", match: { data: { key: "lava" } }, style: { shader: { id: "heat", uniforms: { uStrength: 2 } }, filters: [{ type: "glow", color: "#ff6a00", strength: 3 }] } })
    await ctx.render.postShader({ id: "old-map", shader: "parchment", order: 1 })
    await ctx.render.layerShader({ id: "water-layer", layers: [0], shader: "ripple" })
    await ctx.render.fillShader({ id: "ripple-fill", name: { es: "Agua con ondas", en: "Rippling water" }, shader: "ripple", tools: ["water", "material"] })
    await ctx.tools.waterStyle({ id: "calm", name: { es: "Calma", en: "Calm" }, shader: "ripple" })

    const dot = await ctx.render.registerImage("dot.png", DOT_PNG, "image/png")
    await ctx.render.particles({
      id: "rain",
      name: { es: "Lluvia", en: "Rain" },
      toggle: true,
      emitters: [{ area: "map", rate: 200, lifetime: [0.4, 0.8], speed: [12, 16], direction: [100, 110], size: [0.03, 0.05], color: "#9ec9ff", alpha: [0.3, 0.6], asset: dot }],
    })
    await ctx.render.lightType({ id: "torch", name: { es: "Antorcha", en: "Torch" }, falloff: "smooth", flicker: 0.3 })
    await ctx.render.lightType({ id: "lantern", name: { es: "Linterna", en: "Lantern" }, falloff: [1, 0.9, 0.5, 0.1, 0], cone: 60 })

    // Embers over every fire object, recomputed on demand.
    await ctx.ui.command({
      id: "embers",
      title: { es: "Brasas sobre el fuego", en: "Embers over fire" },
      run: async () => {
        const fires = await ctx.map.query({ hasData: "lava" })
        await ctx.render.setParticles(
          "embers",
          fires.map((f) => ({ area: f.position, rate: 15, lifetime: [0.5, 1.5], speed: [0.3, 0.8], direction: [-110, -70], size: [0.04, 0.08], color: ["#ff6a00", "#ffd000"], gravity: { x: 0, y: -0.2 } })),
        )
        await ctx.render.invalidate()
      },
    })
  },
})
