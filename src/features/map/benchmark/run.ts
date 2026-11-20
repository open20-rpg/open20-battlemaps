import { Application, Container, GlProgram } from "pixi.js"
import { ESSENTIALS_PACK_ID } from "../../packs/essentials"
import { getLibraryItems, releaseLibrarySearch, searchLibrary } from "../../library/api"
import { BUILTIN_BIOME_TEXTURES, builtinTerrainId } from "../../tools/controls/biome/biomes"
import { useSettingsStore } from "../../../stores/settingsStore"
import {
  canvasResolution,
  GRAPHICS_PRESETS,
  MIN_FPS,
  PRESET_SETTINGS,
  suggestPreset,
  type GraphicsPreset,
} from "../../../lib/renderPerformance"
import { AssetCache } from "../render/assets"
import { MapScene, type SceneState } from "../render/scene"
import { nextFrame, timeFrames } from "../render/perfProfile"
import { computeWorldTransform, tileSizeForZoom } from "../render/viewport"
import { DEFAULT_LEVEL_ID, type MapDocument } from "../model/types"
import { BENCHMARK_MAP_SIZE, benchmarkMap, type BenchmarkAssets } from "./benchmarkMap"

/**
 * The automatic graphics setup: the test map (benchmarkMap.ts) drawn with
 * each preset, from Low up, on a canvas of its own (its own WebGL context
 * and texture cache: the open map and its canvas are never touched), the
 * view moving every frame as when panning. It stops going up once a preset
 * runs under MIN_FPS, and suggests the one closest to TARGET_FPS.
 */

export interface PresetResult {
  preset: GraphicsPreset
  fps: number
}

export interface BenchmarkResult {
  results: PresetResult[]
  suggested: GraphicsPreset | null
}

/** How many of each kind of asset the test map takes. */
const TAKE = { objects: 40, walls: 4, tilesets: 7, paths: 2 }

/** The ids of `category`'s first `limit` assets: Open20 Essentials', else any enabled pack's. */
async function firstAssets(category: string, limit: number): Promise<string[]> {
  const key = `benchmark:${category}`
  try {
    for (const packId of [ESSENTIALS_PACK_ID, undefined]) {
      const { total } = await searchLibrary(key, category, { query: "", exactness: 0, packId })
      if (total > 0) return (await getLibraryItems(key, 0, limit)).map((i) => i.id)
    }
    return []
  } finally {
    void releaseLibrarySearch(key)
  }
}

async function benchmarkAssets(): Promise<BenchmarkAssets> {
  const [objects, walls, tilesets, paths] = await Promise.all([
    firstAssets("objects", TAKE.objects),
    firstAssets("walls", TAKE.walls),
    firstAssets("tilesets", TAKE.tilesets),
    firstAssets("paths", TAKE.paths),
  ])
  return {
    terrain: BUILTIN_BIOME_TEXTURES.prairie.map(builtinTerrainId),
    objects,
    walls,
    tilesets,
    paths,
  }
}

/** Every asset id the test map draws (to wait for its textures). */
function assetIds(doc: MapDocument): string[] {
  const ids = new Set<string>()
  const add = (v: unknown) => {
    if (typeof v === "string" && v.includes("|")) ids.add(v)
    const sel = v as { assets?: unknown } | undefined
    if (sel && Array.isArray(sel.assets)) for (const a of sel.assets) add(a)
  }
  for (const e of doc.entities) {
    for (const v of Object.values(e.params)) add(v)
    const terrain = e.params.terrain as { slots?: unknown[] } | undefined
    for (const slot of terrain?.slots ?? []) add(slot)
  }
  return [...ids]
}

/** Frames per second of the test map with `preset`, on a canvas of its own. */
async function measurePreset(preset: GraphicsPreset, doc: MapDocument): Promise<number> {
  const perf = PRESET_SETTINGS[preset]
  const width = Math.max(1, window.innerWidth)
  const height = Math.max(1, window.innerHeight)
  const precision = GlProgram.defaultOptions.preferredFragmentPrecision
  GlProgram.defaultOptions.preferredFragmentPrecision = perf.highPrecision ? "highp" : "mediump"
  const assets = new AssetCache()
  assets.configure({ scale: perf.textureScale, mipmaps: perf.mipmaps })
  const app = new Application()
  let scene: MapScene | null = null
  try {
    await app.init({
      preference: "webgl",
      width,
      height,
      antialias: perf.antialias,
      useBackBuffer: perf.waterEffect,
      resolution: canvasResolution(window.devicePixelRatio, perf),
      autoStart: false,
      sharedTicker: false,
    })
    scene = new MapScene(app.renderer, assets)
    const world = new Container()
    world.addChild(scene.content)
    app.stage.addChild(world)
    // The whole test map fills the screen.
    const { width: mw, height: mh } = BENCHMARK_MAP_SIZE
    const zoom = (100 * Math.min(width / mw, height / mh)) / tileSizeForZoom(100)
    const t = computeWorldTransform(width, height, mw, mh, zoom, { x: 0, y: 0 })
    world.position.set(t.x, t.y)
    world.scale.set(t.scaleX, t.scaleY)

    const settings = useSettingsStore.getState()
    const state: SceneState = {
      map: doc,
      level: DEFAULT_LEVEL_ID,
      lighting: true,
      shadows: true,
      shadowStyle: settings.shadowStyle,
      postProcess: doc.postProcess,
      textVisible: true,
      editingText: null,
      terrainEnabled: true,
      showOutside: false,
      terrainSmooth: false,
      showCaveBlast: false,
      draft: [],
      guide: null,
      compareLevel: null,
      selection: [],
      transformHandles: false,
      zoom,
      referenceUrl: null,
      performance: perf,
    }
    scene.update(state)
    await assets.whenLoaded(assetIds(doc))
    // Textures that arrived (and the building wear, loaded by URL) drawn in.
    await nextFrame()
    scene.update(state, true)
    await nextFrame()
    const live = scene
    const x = world.position.x
    // A pixel back and forth every frame: the view moves, as when panning.
    const ms = timeFrames(
      app,
      () => live.prerender(),
      (i) => (world.position.x = x + (i % 2 ? 1 : -1)),
    )
    return 1000 / Math.max(ms, 0.1)
  } finally {
    // Browsers keep a few WebGL contexts at most and drop the oldest past
    // that (it could be the open map's): this one is released right away.
    const renderer = app.renderer as typeof app.renderer | undefined
    const gl = renderer && "gl" in renderer ? (renderer.gl as WebGL2RenderingContext) : null
    scene?.destroy()
    app.destroy(true, { children: true })
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
    assets.dispose()
    GlProgram.defaultOptions.preferredFragmentPrecision = precision
  }
}

/**
 * Run the automatic setup, reporting each preset as it's measured. Nothing
 * is applied: the caller decides (see `suggested`).
 */
export async function runGraphicsBenchmark(
  onResult?: (result: PresetResult) => void,
): Promise<BenchmarkResult> {
  const doc = benchmarkMap(await benchmarkAssets())
  const results: PresetResult[] = []
  for (const preset of GRAPHICS_PRESETS) {
    const fps = await measurePreset(preset, doc)
    results.push({ preset, fps })
    onResult?.({ preset, fps })
    if (fps < MIN_FPS) break
    await nextFrame()
  }
  return { results, suggested: suggestPreset(results) }
}
