import { defaultFilterVert, Filter, GlProgram, UniformGroup } from "pixi.js"
import { hexToPixiColor } from "../../../lib/colors"

/**
 * Paints the (black) shadow silhouettes in the shadow color at the shadow
 * opacity, in one pass over the whole shadow layer: overlapping shadows
 * stay one even shade instead of darkening each other.
 */
const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uColor;
uniform float uOpacity;

void main(void) {
  finalColor = vec4(uColor, 1.0) * texture(uTexture, vTextureCoord).a * uOpacity;
}
`

let program: GlProgram | undefined

export class ShadowTintFilter extends Filter {
  constructor() {
    program ??= GlProgram.from({ vertex: defaultFilterVert, fragment, name: "shadow-tint" })
    super({
      glProgram: program,
      resources: {
        shadowUniforms: new UniformGroup({
          uColor: { value: new Float32Array([0, 0, 0]), type: "vec3<f32>" },
          uOpacity: { value: 1, type: "f32" },
        }),
      },
    })
  }

  /** Set the shadow color ("#rrggbb") and opacity (0..1). */
  setStyle(color: string, opacity: number): void {
    const u = (this.resources.shadowUniforms as UniformGroup).uniforms as {
      uColor: Float32Array
      uOpacity: number
    }
    const c = hexToPixiColor(color).color
    u.uColor[0] = ((c >> 16) & 255) / 255
    u.uColor[1] = ((c >> 8) & 255) / 255
    u.uColor[2] = (c & 255) / 255
    u.uOpacity = opacity
  }
}
