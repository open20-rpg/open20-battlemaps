import { Container, RenderTexture, Sprite, Texture, type Renderer } from "pixi.js"
import { hexToPixiColor } from "../../../lib/colors"
import { type MapEntity } from "../model/types"
import { type RenderEnv, selectionAsset } from "./entities"
import { lightFalloffTexture } from "./generated"
import { maskResolution, type Composite, type MapBox } from "./painted"

const num = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback)

/**
 * The light map: a map-sized render texture filled with the ambient color,
 * with every light added on top (additive), then multiplied over the scene.
 * With a white ambient (the default) the map looks fully lit and lights are
 * invisible — the same as Dungeondraft until you darken the environment.
 */
export function lightingComposite(
  lights: readonly MapEntity[],
  ambient: string,
  map: MapBox,
  renderer: Renderer,
  env: RenderEnv,
): Composite {
  const res = Math.max(4, Math.floor(maskResolution(map) / 2))
  const rt = RenderTexture.create({ width: map.width * res, height: map.height * res })
  const stage = new Container()
  stage.scale.set(res)
  stage.position.set(map.width * res, 0)

  const bg = new Sprite(Texture.WHITE)
  bg.position.set(-map.width, 0)
  bg.width = map.width
  bg.height = map.height
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
  }
  renderer.render({ container: stage, target: rt, clear: true })
  stage.destroy({ children: true })

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
