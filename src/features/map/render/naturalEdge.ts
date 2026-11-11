import { defaultFilterVert, Filter, GlProgram } from "pixi.js"

/**
 * Turns a soft brush coverage into Dungeondraft-style "natural" terrain
 * blending (Smooth Blending off): instead of a round, fading edge, coverage is
 * thresholded against fractal noise, so the transition between textures
 * breaks up into irregular, organic patches.
 *
 * The noise is computed from the target pixel position divided by the mask's
 * px-per-tile, i.e. it's anchored to the map, not to the stroke — every
 * stroke and repaint agrees on the same pattern, like a height map would.
 */
const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
// highp to match the default filter vertex shader's declarations.
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform float uPxPerTile;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    v += a * valueNoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

void main(void) {
  float coverage = texture(uTexture, vTextureCoord).a;
  vec2 px = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  // ~5 noise cells per tile, octaves add finer grain.
  float n = fbm(px / uPxPerTile * 5.0);
  // Remap the noise into the middle of the coverage range so full coverage
  // always wins and zero always loses; only the falloff band breaks up.
  float threshold = mix(0.15, 0.85, n);
  float a = smoothstep(threshold - 0.04, threshold + 0.04, coverage);
  finalColor = vec4(a);
}
`

/** A natural-edge filter for a mask rendered at `pxPerTile` px per map tile. */
export function naturalEdgeFilter(pxPerTile: number): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "natural-edge" }),
    resources: {
      naturalEdgeUniforms: { uPxPerTile: { value: pxPerTile, type: "f32" } },
    },
  })
}
