import { defaultFilterVert, Filter, GlProgram, UniformGroup } from "pixi.js"
import { POST_FILTERS, type PostProcess } from "../../../lib/postProcess"

/** The map's post-processing on the GPU; mirrors lib/postProcess.ts's applyPostProcess. */
const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
uniform float uFilter;
uniform float uThreshold;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main(void) {
  vec4 src = texture(uTexture, vTextureCoord);
  if (src.a <= 0.0) { finalColor = src; return; }
  vec3 c = src.rgb / src.a;
  c = (c - 0.5) * (1.0 + uContrast) + 0.5 + uBrightness;
  float y = luma(c);
  c = y + (c - y) * (1.0 + uSaturation);
  if (uFilter > 0.5 && uFilter < 1.5) {
    c = vec3(luma(c));
  } else if (uFilter > 1.5 && uFilter < 2.5) {
    c = vec3(
      dot(c, vec3(0.393, 0.769, 0.189)),
      dot(c, vec3(0.349, 0.686, 0.168)),
      dot(c, vec3(0.272, 0.534, 0.131))
    );
  } else if (uFilter > 2.5 && uFilter < 3.5) {
    c = vec3(step(uThreshold, luma(c)));
  } else if (uFilter > 3.5) {
    c = 1.0 - c;
  }
  finalColor = vec4(clamp(c, 0.0, 1.0) * src.a, src.a);
}
`

let program: GlProgram | undefined

export class PostProcessFilter extends Filter {
  constructor() {
    program ??= GlProgram.from({ vertex: defaultFilterVert, fragment, name: "post-process" })
    super({
      glProgram: program,
      resources: {
        postUniforms: new UniformGroup({
          uBrightness: { value: 0, type: "f32" },
          uContrast: { value: 0, type: "f32" },
          uSaturation: { value: 0, type: "f32" },
          uFilter: { value: 0, type: "f32" },
          uThreshold: { value: 0.5, type: "f32" },
        }),
      },
    })
  }

  set(pp: PostProcess): void {
    const u = (this.resources.postUniforms as UniformGroup).uniforms as Record<string, number>
    u.uBrightness = pp.brightness
    u.uContrast = pp.contrast
    u.uSaturation = pp.saturation
    u.uFilter = Math.max(0, POST_FILTERS.indexOf(pp.filter))
    u.uThreshold = pp.threshold
  }
}
