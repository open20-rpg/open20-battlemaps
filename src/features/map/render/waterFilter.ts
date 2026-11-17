import { Filter, GlProgram } from "pixi.js"

/**
 * Water's look over what lies beneath it: the water keeps its own
 * (ring-gradient) color, but the dark parts underneath — floor lines,
 * terrain detail, objects — show through and darken it (below 50 %
 * brightness, by smoothstep), while light ones don't show. The backdrop is
 * not rippled over time: the map is redrawn on demand, so it stays still.
 */
const vertex = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`

const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uBackTexture;

void main(void) {
  vec4 water = texture(uTexture, vTextureCoord);
  vec3 below = texture(uBackTexture, vTextureCoord).rgb;
  float avg = (below.r + below.g + below.b) / 3.0;
  float k = avg < 0.5 ? smoothstep(0.0, 0.5, avg) : 1.0;
  finalColor = vec4(water.rgb * k, water.a);
}
`

let program: GlProgram | undefined

export class WaterFilter extends Filter {
  constructor() {
    program ??= GlProgram.from({ vertex, fragment, name: "water" })
    // The backdrop is copied at the screen's resolution; the filter's input
    // must be too, or the two don't line up (filters default to 1: on a
    // 2–3× phone screen the water showed a magnified, shifted backdrop).
    super({ glProgram: program, resources: {}, blendRequired: true, resolution: "inherit" })
  }
}
