import { type Graphics } from "pixi.js"
import { useEffect, type RefObject } from "react"
import { useExtensionsStore } from "../../../stores/extensionsStore"
import { useViewStore } from "../../../stores/viewStore"
import { assetCache } from "./assets"
import { drawPrimitives, extensionBridge, type PrimitiveEnv } from "./extensionRender"
import { type MapScene } from "./scene"
import { viewGestureActive } from "./viewGesture"

/**
 * What the canvas does for extensions, kept out of MapCanvas: their
 * animations (a frame loop only while something animated shows) and grid
 * kinds they draw instead of the square one.
 */

/** Redraw every frame while an extension's animation shows (and Animations is on). */
export function useExtensionAnimation(
  ready: boolean,
  sceneRef: RefObject<MapScene | null>,
  requestRender: RefObject<(changed?: boolean) => void>,
): void {
  useEffect(() => {
    const scene = sceneRef.current
    if (!ready || !scene) return
    let anim = 0
    let last = 0
    const animate = (now: number) => {
      anim = 0
      if (!extensionBridge()?.animating() || viewGestureActive()) return
      scene.tick(last ? (now - last) / 1000 : 0, now / 1000)
      last = now
      requestRender.current(true)
      anim = requestAnimationFrame(animate)
    }
    const maybeAnimate = () => {
      if (!anim && extensionBridge()?.animating()) {
        last = 0
        anim = requestAnimationFrame(animate)
      }
    }
    maybeAnimate()
    const unsubExtensions = useExtensionsStore.subscribe(maybeAnimate)
    const unsubView = useViewStore.subscribe(maybeAnimate)
    return () => {
      cancelAnimationFrame(anim)
      unsubExtensions()
      unsubView()
    }
  }, [ready, sceneRef, requestRender])
}

/** What drawing an extension's grid needs: textures from the cache, nothing else. */
const gridEnv: PrimitiveEnv = {
  tex: (id) => (id ? assetCache.texture(id) : undefined),
  image: (url) => assetCache.textureFromUrl(url),
}

/**
 * Draw an extension's grid kind into `grid` (redrawn when the extension's
 * answer arrives). Returns what stops following it.
 */
export function drawExtensionGrid(
  grid: Graphics,
  kind: string,
  width: number,
  height: number,
  requestRender: () => void,
): () => void {
  const draw = () => {
    const prims = extensionBridge()?.gridPrimitives(kind, width, height)
    grid.clear()
    for (const child of grid.removeChildren()) child.destroy({ children: true })
    if (prims) {
      const layer = drawPrimitives(prims, gridEnv)
      // The world mirrors x; primitives are drawn mirrored back (content space).
      layer.scale.x = -1
      grid.addChild(layer)
    }
    requestRender()
  }
  draw()
  return extensionBridge()?.subscribe(draw) ?? (() => {})
}
