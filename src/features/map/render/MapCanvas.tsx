import { useEffect, useRef, useState } from "react"
import { Box } from "@chakra-ui/react"
import { Application, Container, Graphics } from "pixi.js"
import { useMapStore } from "../../../stores/mapStore"
import { useViewStore } from "../../../stores/viewStore"
import { getToolParams, selectActiveTool, useToolsStore } from "../../../stores/toolsStore"
import { useEditorStore } from "../../../stores/editorStore"
import { useSettingsStore } from "../../../stores/settingsStore"
import { drawGrid, type GridStyle } from "./grid"
import { computeWorldTransform } from "./viewport"
import { useViewportGestures } from "./useViewportGestures"
import { assetCache } from "./assets"
import { MapScene, type SceneState } from "./scene"
import { referenceImageUrl, subscribeReferenceImages } from "./referenceImages"
import { setActiveRenderer } from "./exportMap"

/** Fill color of the map rect under every layer. */
const MAP_BG = 0x2b2b2f

/** Gather everything the scene draws from the stores. */
function sceneState(): SceneState | null {
  const map = useMapStore.getState().map
  if (!map) return null
  const view = useViewStore.getState()
  const editor = useEditorStore.getState()
  const ref = map.referenceImage
  return {
    map,
    level: editor.activeLevel,
    lighting: view.lighting,
    shadows: view.shadows,
    showOutside: view.outside,
    shadowStyle: useSettingsStore.getState().shadowStyle,
    postProcess: useSettingsStore.getState().postProcess,
    textVisible: getToolParams("text").visible !== false,
    terrainEnabled: getToolParams("terrainBrush").enable !== false,
    terrainSmooth: getToolParams("terrainBrush").smoothBlending === true,
    draft: editor.draft,
    selection: editor.selection,
    transformHandles: selectActiveTool(useToolsStore.getState())?.id === "select",
    zoom: view.zoom,
    referenceUrl: ref ? referenceImageUrl(ref.path) : null,
  }
}

/**
 * The map viewport, rendered with PixiJS (WebGL) for performance/memory
 * headroom once real layers and many entities land. Structure:
 *  - `world`: a container mirrored/scaled to map the map's tile space (origin
 *    at the map's top-right corner) onto screen space; panning/zooming is
 *    just this container's transform, never a redraw.
 *  - `mapBg`: placeholder fill standing in for layer rendering (rebuilds only
 *    when the map's dimensions change).
 *  - `grid`: the tile grid, drawn on top of every layer. Above 200% zoom every
 *    style's on-screen size scales for free via the world transform, so it
 *    only rebuilds on param/dimension changes there; at/below 200% each style
 *    freezes at a fixed screen size (and dotted/dashes switch to a square-dot
 *    look), which requires recomputing world-unit sizes from the current zoom
 *    — so it also rebuilds on every zoom tick while in that range.
 */
export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const worldRef = useRef<Container | null>(null)
  const mapBgRef = useRef<Graphics | null>(null)
  const gridRef = useRef<Graphics | null>(null)
  const sceneRef = useRef<MapScene | null>(null)
  /** Repaint on the next frame (the canvas doesn't render continuously). */
  const requestRenderRef = useRef<() => void>(() => {})
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
  const gridLineColor = gridParams.gridLineColor as string

  useViewportGestures(containerRef)

  // Set up the Pixi application once.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let disposed = false
    const app = new Application()
    // Follow the container's size (window resizes, panels opening), then repaint.
    const resizer = new ResizeObserver(() => {
      if (!appRef.current) return
      app.renderer.resize(Math.max(1, el.clientWidth), Math.max(1, el.clientHeight))
      requestRender()
    })
    resizer.observe(el)
    let frame = 0
    const requestRender = () => {
      if (frame || disposed) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!disposed) app.render()
      })
    }

    app
      .init({
        // The painted-layer filters (natural terrain edges) ship GLSL only.
        preference: "webgl",
        width: Math.max(1, el.clientWidth),
        height: Math.max(1, el.clientHeight),
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
        // Render on demand (requestRender), not 60 times a second: an idle
        // map then costs nothing, and the painted-layer filters only run
        // when something actually changed.
        autoStart: false,
        sharedTicker: false,
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
        requestRenderRef.current = requestRender
        const scene = new MapScene(app.renderer, assetCache, requestRender)
        world.addChild(mapBg, scene.content, grid, scene.overlay)
        app.stage.addChild(world)
        appRef.current = app
        worldRef.current = world
        mapBgRef.current = mapBg
        gridRef.current = grid
        sceneRef.current = scene
        setActiveRenderer({ renderer: app.renderer, scene })
        setReady(true)
      })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resizer.disconnect()
      setActiveRenderer(null)
      sceneRef.current?.destroy()
      sceneRef.current = null
      if (appRef.current) {
        appRef.current.destroy(true, { children: true })
        appRef.current = null
      }
    }
  }, [])

  // Re-render on canvas resizes so the world transform below is recomputed.
  // Separate from the init effect: the renderer only exists once init()
  // resolves (`ready`), and this way the subscription owns its own cleanup.
  useEffect(() => {
    const renderer = appRef.current?.renderer
    if (!ready || !renderer) return
    const onResize = () => bumpResize((n) => n + 1)
    renderer.on("resize", onResize)
    return () => {
      renderer.off("resize", onResize)
    }
  }, [ready])

  // Keep the scene in sync with the document, editor and view stores. This
  // is imperative (store subscriptions, not React state) so editing the map
  // never re-renders React components.
  useEffect(() => {
    const scene = sceneRef.current
    if (!ready || !scene) return
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const state = sceneState()
        if (state) scene.update(state)
        requestRenderRef.current()
      })
    }
    schedule()
    const unsubMap = useMapStore.subscribe(schedule)
    const unsubEditor = useEditorStore.subscribe(schedule)
    const unsubView = useViewStore.subscribe(schedule)
    const unsubTools = useToolsStore.subscribe(schedule)
    const unsubRef = subscribeReferenceImages(schedule)
    const unsubSettings = useSettingsStore.subscribe(schedule)
    return () => {
      cancelAnimationFrame(frame)
      unsubMap()
      unsubEditor()
      unsubView()
      unsubTools()
      unsubRef()
      unsubSettings()
    }
  }, [ready])

  // Position/scale the world container: cheap (no geometry rebuild) so this
  // runs on every zoom/pan tick and resize without any redraw cost. Also
  // corrects the stored pan if it's out of the clamped range (e.g. a resize
  // shrunk the viewport), so the map can never end up panned fully off-screen.
  useEffect(() => {
    const app = appRef.current
    const world = worldRef.current
    if (!app || !world || mapWidth == null || mapHeight == null) return
    const t = computeWorldTransform(
      app.screen.width,
      app.screen.height,
      mapWidth,
      mapHeight,
      zoom,
      {
        x: panX,
        y: panY,
      },
    )
    world.position.set(t.x, t.y)
    world.scale.set(t.scaleX, t.scaleY)
    requestRenderRef.current()
    if (t.pan.x !== panX || t.pan.y !== panY) {
      useViewStore.getState().setPan(t.pan.x, t.pan.y)
    }
  })

  // Rebuild the map-rect placeholder only when the map's own dimensions change.
  useEffect(() => {
    const mapBg = mapBgRef.current
    if (!mapBg || mapWidth == null || mapHeight == null) return
    mapBg.clear().rect(0, 0, mapWidth, mapHeight).fill({ color: MAP_BG })
    requestRenderRef.current()
  }, [ready, mapWidth, mapHeight])

  // Rebuild the grid geometry on param/dimension changes, and on zoom changes
  // too — needed at/below the 200% floor threshold to keep each style's fixed
  // screen size correct (see the component doc comment).
  useEffect(() => {
    const grid = gridRef.current
    if (!grid || mapWidth == null || mapHeight == null) return
    drawGrid(grid, mapWidth, mapHeight, { style: gridStyle, color: gridLineColor }, zoom)
    requestRenderRef.current()
  }, [ready, mapWidth, mapHeight, gridStyle, gridLineColor, zoom])

  // Toggling the overlay is just a visibility flip, no rebuild.
  useEffect(() => {
    const grid = gridRef.current
    if (grid) grid.visible = gridOn
    requestRenderRef.current()
  }, [ready, gridOn])

  return <Box ref={containerRef} position="absolute" inset="0" overflow="hidden" />
}
