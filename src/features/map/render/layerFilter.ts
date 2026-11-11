import {
  Filter,
  GlProgram,
  Matrix,
  TextureMatrix,
  UniformGroup,
  type FilterSystem,
  type RenderSurface,
  type Sprite,
  type Texture,
} from "pixi.js"

/**
 * One filter pass for a painted layer (cave, water, material): the fill shows
 * only where a coverage sprite covers.
 *
 * It replaces Pixi's sprite masks on purpose: those render the whole masked
 * area off-screen without clipping to the viewport, so zoomed in on a large
 * map they ask for a texture larger than the GPU allows (the layer vanishes,
 * or the GPU runs out of memory) and get slower the more you zoom. This one
 * is clipped to the screen like any filter.
 *
 * Coverage comes from render textures (premultiplied), so its alpha is the
 * coverage itself.
 */
const vertex = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vMaskCoord;

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
  vMaskCoord = (uFilterMatrix * vec3(vTextureCoord, 1.0)).xy;
}
`

const fragment = /* glsl */ `
in vec2 vTextureCoord;
in vec2 vMaskCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMaskTexture;
uniform vec4 uMaskClamp;

void main(void) {
  float inside = step(3.5,
    step(uMaskClamp.x, vMaskCoord.x) + step(uMaskClamp.y, vMaskCoord.y) +
    step(vMaskCoord.x, uMaskClamp.z) + step(vMaskCoord.y, uMaskClamp.w));
  finalColor = texture(uTexture, vTextureCoord) * texture(uMaskTexture, vMaskCoord).a * inside;
}
`

let program: GlProgram | undefined

export class LayerMaskFilter extends Filter {
  private readonly textureMatrix: TextureMatrix

  constructor(private readonly mask: Sprite) {
    const textureMatrix = new TextureMatrix(mask.texture)
    program ??= GlProgram.from({ vertex, fragment, name: "layer-mask" })
    super({
      glProgram: program,
      resources: {
        layerUniforms: new UniformGroup({
          uFilterMatrix: { value: new Matrix(), type: "mat3x3<f32>" },
          uMaskClamp: { value: textureMatrix.uClampFrame, type: "vec4<f32>" },
        }),
        uMaskTexture: mask.texture.source,
      },
    })
    this.textureMatrix = textureMatrix
  }

  override apply(
    filterManager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clearMode: boolean,
  ): void {
    const uniforms = (this.resources.layerUniforms as UniformGroup).uniforms as {
      uFilterMatrix: Matrix
    }
    this.textureMatrix.texture = this.mask.texture
    this.textureMatrix.update()
    filterManager
      .calculateSpriteMatrix(uniforms.uFilterMatrix, this.mask)
      .prepend(this.textureMatrix.mapCoord)
    filterManager.applyFilter(this, input, output, clearMode)
  }

  override destroy(): void {
    this.textureMatrix.destroy()
    super.destroy()
  }
}
