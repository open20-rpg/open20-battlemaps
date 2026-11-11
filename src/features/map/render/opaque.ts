import { defaultFilterVert, Filter, GlProgram } from "pixi.js"

/**
 * Draws a texture fully opaque, keeping its color where it was translucent.
 * Dungeondraft's terrain shader mixes the textures' colors and ignores their
 * alpha, and some packs ship terrain textures with an alpha channel: drawn
 * as-is they'd let the (black) ground show through and look dark.
 *
 * Filter input is premultiplied, so dividing by alpha recovers the color.
 */
const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;

void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  finalColor = c.a > 0.0 ? vec4(c.rgb / c.a, 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
}
`

let program: GlProgram | undefined

export function opaqueFilter(): Filter {
  program ??= GlProgram.from({ vertex: defaultFilterVert, fragment, name: "opaque" })
  return new Filter({ glProgram: program, resources: {} })
}
