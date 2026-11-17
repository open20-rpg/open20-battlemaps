import {
  colorBit,
  colorBitGl,
  compileHighShaderGl,
  fragmentGlTemplate,
  GlProgram,
  globalUniformsBitGl,
  vertexGlTemplate,
  compileHighShaderGpuProgram,
  generateTextureBatchBit,
  generateTextureBatchBitGl,
  localUniformMSDFBit,
  localUniformMSDFBitGl,
  roundPixelsBit,
  roundPixelsBitGl,
  BitmapTextPipe,
  extensions,
  SdfShader,
  type GpuProgram,
} from "pixi.js"

/**
 * The distance-field text shader: with the field d
 * (0..1, 0.5 on the glyph's edge), s = d − 0.5 and the coverage is
 * clamp(s / fwidth(s) + 0.5, 0, 1) — the edge antialiased over one screen
 * pixel at any zoom. (Pixi's own takes the screen scale from the text's
 * render group, which the map's zoom isn't part of: edges went hard when
 * zoomed out.) The color is the font color, its alpha times the coverage.
 */
const sdfBit = {
  name: "msdf-bit",
  fragment: {
    header: /* wgsl */ `
      fn calculateMSDFAlpha(msdfColor: vec4<f32>, shapeColor: vec4<f32>, distance: f32) -> f32 {
        let s = msdfColor.a - 0.5;
        return clamp(s / max(fwidth(s), 0.0001) + 0.5, 0.0, 1.0);
      }
    `,
  },
}

const sdfBitGl = {
  name: "msdf-bit",
  fragment: {
    header: /* glsl */ `
      float calculateMSDFAlpha(vec4 msdfColor, vec4 shapeColor, float distance) {
        float s = msdfColor.a - 0.5;
        return clamp(s / max(fwidth(s), 0.0001) + 0.5, 0.0, 1.0);
      }
    `,
  },
}

let gpuProgram: GpuProgram | undefined
let glProgram: GlProgram | undefined

/** Pixi's SDF text shader (same uniforms and batching) with {@link sdfBit}'s coverage. */
class FwidthSdfShader extends SdfShader {
  constructor(maxTextures: number) {
    super(maxTextures)
    this.gpuProgram = gpuProgram ??= compileHighShaderGpuProgram({
      name: "sdf-fwidth-shader",
      bits: [
        colorBit,
        generateTextureBatchBit(maxTextures),
        localUniformMSDFBit,
        sdfBit,
        roundPixelsBit,
      ],
    })
    // fwidth needs GLSL ES 3.00: Pixi's templates compile as 1.00 unless they
    // declare the version (then it also skips its WebGL1 compatibility defines).
    glProgram ??= new GlProgram({
      name: "sdf-fwidth-shader",
      ...compileHighShaderGl({
        template: {
          vertex: `#version 300 es\n${vertexGlTemplate}`,
          fragment: `#version 300 es\n${fragmentGlTemplate}`,
        },
        bits: [
          globalUniformsBitGl,
          colorBitGl,
          generateTextureBatchBitGl(maxTextures),
          localUniformMSDFBitGl,
          sdfBitGl,
          roundPixelsBitGl,
        ],
      }),
    })
    this.glProgram = glProgram
  }
}

/** The bitmap text pipe, drawing distance-field fonts with {@link FwidthSdfShader}. */
class FwidthBitmapTextPipe extends BitmapTextPipe {
  static extension = BitmapTextPipe.extension

  protected getSdfShader(): SdfShader {
    return new FwidthSdfShader(this._renderer.limits.maxBatchableTextures)
  }
}

/**
 * Swap Pixi's bitmap text pipe for {@link FwidthBitmapTextPipe}; renderers
 * created after this use it. Idempotent.
 */
let installed = false
export function installSdfTextPipe(): void {
  if (installed) return
  installed = true
  extensions.remove(BitmapTextPipe)
  extensions.add(FwidthBitmapTextPipe)
}
