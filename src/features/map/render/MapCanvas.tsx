import { useEffect, useRef, useState } from "react"
import { Box } from "@chakra-ui/react"
import { Application, Container, Graphics } from "pixi.js"
import { useMapStore } from "../../../stores/mapStore"
import { useViewStore } from "../../../stores/viewStore"
import { getToolParams, useToolsStore } from "../../../stores/toolsStore"
import { drawGrid, type GridStyle } from "./grid"
import { computeWorldTransform } from "./viewport"
import { useViewportGestures } from "./useViewportGestures"

/** Fill color for the map rect until real layers render into it. */
const MAP_BG = 0x2b2b2f

/**
 * The map viewport, rendered with PixiJS (WebGL) for performance/memory
 * headroom once real layers and many entities land. Structure:
 *  - `world`: a container mirrored/scaled to map the map's tile space (origin
 *    at the map's top-right corner) onto screen space; panning/zooming is
 *    just this container's transform, never a redraw.
 *  - `mapBg`: placeholder fill standing in for layer rendering (rebuilds only
 *    when the map's dimensions change).
 *  - `grid`: the tile grid, drawn on top of every layer (rebuilds only when
 *    its own params or the map's dimensions change — never on zoom, since its
 *    geometry lives in tile units and the world transform scales it for free).
 */
export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const worldRef = useRef<Container | null>(null)
  const mapBgRef = useRef<Graphics | null>(null)
  const gridRef = useRef<Graphics | null>(null)
  // Flips once the async Pixi init resolves, just to trigger the render that
  // lets the effects below see the now-populated refs.
  const [ready, setReady] = useState(false)
  // Bumped on every renderer resize, just to force the world-transform effect
  // (which reads app.screen.width/height) to recompute and re-clamp the pan.
  const [, bumpResize] = useState(0)

  const map = useMapStore((s) => s.map)
  // Read as primitives so the rebuild effects below depend on the dimensions
  // themselves, not the map object reference (which changes on every entity
  // edit too — dimensions rarely do).
  const mapWidth = map?.width
  const mapHeight = map?.height
  const zoom = useViewStore((s) => s.zoom)
  const panX = useViewStore((s) => s.panX)
  const panY = useViewStore((s) => s.panY)
  const gridOn = useViewStore((s) => s.grid)
  // Grid params live on the Map Settings tool, not the view store, so they
  // read live regardless of which tool is currently active. Subscribing to
  // the raw bag re-renders this component on change; getToolParams fills in
  // defaults for params never touched.
  useToolsStore((s) => s.paramsByTool.mapSettings)
  const gridParams = getToolParams("mapSettings")
  const gridStyle = gridParams.gridStyle as GridStyle
  const gridLineWidth = gridParams.gridLineWidth as number
  const gridLineColor = gridParams.gridLineColor as string

  useViewportGestures(containerRef)

  // Set up the Pixi application once.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let disposed = false
    const app = new Application()

    app
      .init({
        resizeTo: el,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      })
      .then(() => {
        if (disposed) {
          app.destroy(true, { children: true })
          return
        }
        el.appendChild(app.canvas)
        const world = new Container()
        const mapBg = new Graphics()
        const grid = new Graphics()
        world.addChild(mapBg, grid)
        app.stage.addChild(world)
        appRef.current = app
        worldRef.current = world
        mapBgRef.current = mapBg
        gridRef.current = grid
        app.renderer.on("resize", () => bumpResize((n) => n + 1))
        setReady(true)
      })

    return () => {
      disposed = true
      if (appRef.current) {
        appRef.current.destroy(true, { children: true })
        appRef.current = null
      }
    }
  }, [])

  // Position/scale the world container: cheap (no geometry rebuild) so this
  // runs on every zoom/pan tick and resize without any redraw cost. Also
  // corrects the stored pan if it's out of the clamped range (e.g. a resize
  // shrunk the viewport), so the map can never end up panned fully off-screen.
  useEffect(() => {
    const app = appRef.current
    const world = worldRef.current
    if (!app || !world || mapWidth == null || mapHeight == null) return
    const t = computeWorldTransform(app.screen.width, app.screen.height, mapWidth, mapHeight, zoom, {
      x: panX,
      y: panY,
    })
    world.position.set(t.x, t.y)
    world.scale.set(t.scaleX, t.scaleY)
    if (t.pan.x !== panX || t.pan.y !== panY) {
      useViewStore.getState().setPan(t.pan.x, t.pan.y)
    }
  })

  // Rebuild the map-rect placeholder only when the map's own dimensions change.
  useEffect(() => {
    const mapBg = mapBgRef.current
    if (!mapBg || mapWidth == null || mapHeight == null) return
    mapBg.clear().rect(0, 0, mapWidth, mapHeight).fill({ color: MAP_BG })
  }, [ready, mapWidth, mapHeight])

  // Rebuild the grid geometry only when its params or the map's dimensions
  // change — zoom is handled for free by the world container's transform.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid || mapWidth == null || mapHeight == null) return
    drawGrid(grid, mapWidth, mapHeight, {
      style: gridStyle,
      lineWidth: gridLineWidth,
      color: gridLineColor,
    })
  }, [ready, mapWidth, mapHeight, gridStyle, gridLineWidth, gridLineColor])

  // Toggling the overlay is just a visibility flip, no rebuild.
  useEffect(() => {
    const grid = gridRef.current
    if (grid) grid.visible = gridOn
  }, [ready, gridOn])

  return <Box ref={containerRef} position="absolute" inset="0" overflow="hidden" />
}
