import { BlurFilter, Container, RenderTexture, Sprite, Texture, type Renderer } from "pixi.js"
import { hexToPixiColor } from "../../../lib/colors"
import { type MapEntity } from "../model/types"
import { lightReach, type RenderEnv, selectionAsset } from "./entities"
import { lightFalloffTexture } from "./generated"
import { maskResolution, type Composite, type MapBox } from "./painted"

const num = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback)

/**
 * The light map: a map-sized render texture filled with the ambient color,
 * with every light added on top (additive), then multiplied over the scene.
 * With a white ambient (the default) the map looks fully lit and lights are
 * invisible until you darken the environment.
 * Lights with Shadow on reach only what walls, closed doors and
 * light-blocking objects let them see (model/lightBlock.ts).
 */
export function lightingComposite(
  lights: readonly MapEntity[],
  ambient: string,
  /** How soft the shadows' edges are: blur in tiles (0 = hard). */
  softness: number,
  /** Settings › Performance: mask detail (fraction) and blur passes (0: none). */
  quality: { maskDetail: number; blurQuality: number },
  map: MapBox,
  renderer: Renderer,
  env: RenderEnv,
): Composite {
  const res = Math.max(2, Math.floor(maskResolution(map, quality.maskDetail) / 2))
  // Shadows are cut with hard polygons at this coarse resolution: blurred
  // (once, here; Effects › Shadows sets how much) they get a soft edge
  // instead of jagged steps.
  const soften =
    softness > 0 && quality.blurQuality > 0
      ? new BlurFilter({ strength: softness * res, quality: quality.blurQuality })
      : null
  const rt = RenderTexture.create({ width: map.width * res, height: map.height * res })
  const stage = new Container()
  stage.scale.set(res)
  stage.position.set(map.width * res, 0)

  // A tile past the map each way, so the blur doesn't fade its edges.
  const bg = new Sprite(Texture.WHITE)
  bg.position.set(-map.width - 1, -1)
  bg.width = map.width + 2
  bg.height = map.height + 2
  bg.tint = hexToPixiColor(ambient).color
  stage.addChild(bg)

  for (const light of lights) {
    const { id } = selectionAsset(light.params.style)
    const range = num(light.params.range, 5)
    const sprite = new Sprite(env.tex(id) ?? lightFalloffTexture())
    sprite.anchor.set(0.5)
    sprite.position.set(-light.position.x, light.position.y)
    sprite.rotation = (light.rotation * Math.PI) / 180
    sprite.width = sprite.height = range * 2
    sprite.tint = hexToPixiColor(
      typeof light.params.color === "string" ? light.params.color : "#eccd8b",
    ).color
    sprite.alpha = Math.min(1, num(light.params.intensity, 1) * 0.8)
    sprite.blendMode = "add"
    stage.addChild(sprite)
    // Walls and closed doors cast its shadows: it lights only what it sees.
    const reach = lightReach(light, env)
    if (reach) {
      stage.addChild(reach)
      sprite.mask = reach
    }
  }
  if (soften) stage.filters = [soften]
  renderer.render({ container: stage, target: rt, clear: true })
  stage.destroy({ children: true })
  soften?.destroy()

  const view = new Sprite(rt)
  view.position.set(-map.width, 0)
  view.scale.set(1 / res)
  view.blendMode = "multiply"
  return {
    view,
    dispose: () => {
      view.destroy()
      rt.destroy(true)
    },
  }
}
