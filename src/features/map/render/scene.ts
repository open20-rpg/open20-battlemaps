import {
  PRESET_SETTINGS,
  type GraphicsPreset,
  type RenderPerformance,
} from "../../../lib/renderPerformance"
import { BlurFilter, Container, Graphics, Sprite, type Renderer } from "pixi.js"
import { type DraftShape } from "../../../stores/editorStore"
import { type ShadowStyle } from "../../../stores/settingsStore"
import { type BuildingWear, type MapDocument, type MapEntity, type Vec2 } from "../model/types"
import { type AssetCache } from "./assets"
import {
  ENTITY_RENDERERS,
  SHADOW_KINDS,
  glowStrength,
  type RenderEnv,
  type ShadowKind,
} from "./entities"
import { ShadowTintFilter } from "./shadowFilter"
import { PostProcessFilter } from "./postProcessFilter"
import { liveTerrainVersion } from "../terrainLive"
import { DEFAULT_POST_PROCESS, isNeutral, type PostProcess } from "../../../lib/postProcess"
import { lightingComposite } from "./lighting"
import { BUILDING_WEAR_URLS } from "./buildingWear"
import { drawOverlay } from "./overlay"
import { drawLayer, zFor } from "../model/drawOrder"
import { PAINTED_COMPOSITES, paintedGroups, paintedLayer, type Composite } from "./painted"
import { tileSizeForZoom } from "./viewport"
import { lightBlockers } from "../model/lightBlock"
import { fontStatus, subscribeFonts } from "../../fonts/registry"
import { clearMeasures } from "../../fonts/metrics"

/** What an exported image includes (the rest of the export look is fixed: no editor overlays). */
export interface ExportLook {
  lighting: boolean
  shadows: boolean
  /** Apply the map's color adjustments (post-processing). */
  postProcess: boolean
  /** No ground color: what's unpainted stays transparent. */
  transparent: boolean
  /** Graphics quality to draw with (its scene settings; textures: see exportMap.ts). */
  quality?: GraphicsPreset
}

/** Everything the scene draws from, gathered from the stores each frame it changes. */
export interface SceneState {
  map: MapDocument
  level: string | null
  lighting: boolean
  shadows: boolean
  /** How shadows look (an app preference, not part of the map). */
  shadowStyle: ShadowStyle
  /** Color adjustments over the whole map (on screen and in exports). */
  postProcess: PostProcess
  textVisible: boolean
  /** The label open in the inline editor: hidden while the editor shows it. */
  editingText?: string | null
  terrainEnabled: boolean
  /** Draw what lies past the map's edges (else the map clips its content). */
  showOutside: boolean
  /** Terrain Brush "Smooth Blending": how every terrain stroke blends (global). */
  terrainSmooth: boolean
  /** Cave tool's "Show blast opened area" (editor only: off in exports). */
  showCaveBlast: boolean
  draft: readonly DraftShape[]
  /** Pinned guide point (editor session). */
  guide: Vec2 | null
  /** Level shown faded under the active one (Compare levels), if any. */
  compareLevel: string | null
  selection: readonly string[]
  /** Show the selection's transform handles (Select tool active). */
  transformHandles: boolean
  zoom: number
  /** Reference image as a loaded data URL (null when none/hidden). */
  referenceUrl: string | null
  /** How the map is rendered, traded against speed (Settings › Performance). */
  performance: RenderPerformance
}

interface EntityView {
  entity: MapEntity
  /** Other entities the view depends on (walls: the level's portals). */
  deps: readonly unknown[]
  /** Render inputs that, if changed, require a redraw. */
  textVisible: boolean
  lighting: boolean
  /** The map's building wear it was drawn with (walls and floors use it). */
  wear: BuildingWear
  /** The text quality it was drawn with (labels' images). */
  textQuality: number
  view: Container
  /** Drop-shadow silhouettes it cast (they live in the shared shadow layer). */
  shadows: Container[]
  /** False when a texture was still loading — redraw once assets arrive. */
  complete: boolean
}

interface CompositeView {
  /** The painted tool it composites. */
  toolId: string
  inputs: readonly unknown[]
  comp: Composite
  complete: boolean
  /** Live terrain version last shown (see terrainLive.ts). */
  live: number
}

/** A part of the scene that can be hidden to measure its cost (see MapScene.profileParts). */
export interface ProfilePart {
  id: string
  /** i18n key of its name; `tool` fills its {{tool}} with a tool's name. */
  labelKey: string
  tool?: string
  show: (on: boolean) => void
}

const sameInputs = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v, i) => v === b[i])

/** Whether `b` is `a` with only its position changed (all else the same values). */
function onlyMoved(a: MapEntity, b: MapEntity): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof MapEntity>
  for (const k of keys) if (k !== "position" && a[k] !== b[k]) return false
  return true
}

/** Move a drawn entity by (dx, dy) map tiles: content space mirrors x. */
function shiftView(entry: EntityView, dx: number, dy: number): void {
  for (const c of [entry.view, ...entry.shadows]) {
    c.position.x -= dx
    c.position.y += dy
  }
}

/** Free an entity's view and the shadows it cast. */
function destroyView(entry: EntityView): void {
  entry.view.destroy({ children: true })
  for (const shadow of entry.shadows) shadow.destroy({ children: true })
}

/**
 * Where the shared shadow layer sits: above floors/caves/terrain (−200 and
 * below), under everything that casts a shadow.
 */
const SHADOW_LAYER = -150

/**
 * The imperative map renderer: owns the Pixi display tree for the document
 * and reconciles it against store state (`update`), redrawing only what
 * changed. Entities are immutable in the store, so reference equality tells
 * us exactly which ones need a new view. Painted tools and lighting are
 * composites rebuilt when any of their inputs change.
 */
/** The map's bare ground, under everything (dark grey, until terrain covers it). */
export const MAP_GROUND_COLOR = 0x3c3c40

export class MapScene {
  /** Map content, un-mirrored (scale.x = -1) — see entities.ts. */
  readonly content = new Container()
  /** Editor overlay (drafts, selection); above the grid. */
  readonly overlay = new Container()
  /**
   * Every drop shadow, drawn as one group: offset, blurred and faded as a
   * whole, so overlapping shadows don't darken each other and changing the
   * shadow style never redraws an entity.
   */
  private shadowLayer = new Container()
  /** One sub-layer per shadow kind, so each can be switched off on its own. */
  private shadowKinds = Object.fromEntries(SHADOW_KINDS.map((k) => [k, new Container()])) as Record<
    ShadowKind,
    Container
  >
  private shadowBlur = new BlurFilter({ strength: 0, quality: 3 })
  private shadowTint = new ShadowTintFilter()
  private post = new PostProcessFilter()
  /** Px per tile the shadow blur is computed for (export overrides the zoom's). */
  private shadowPxPerTile: number | null = null
  private entities = new Map<string, EntityView>()
  private composites = new Map<string, CompositeView>()
  private lighting: CompositeView | null = null
  private reference: { url: string; sprite: Sprite } | null = null
  /** The map's bare ground (MAP_GROUND_COLOR), under everything. */
  private base = new Graphics()
  /**
   * Compare levels: the level below drawn faded under the active one
   * (its objects, walls, paths… — not its painted layers or lights).
   */
  private compare = new Container()
  private compareViews = new Map<
    string,
    { entity: MapEntity; view: Container; complete: boolean }
  >()
  /** Clips the content to the map's rectangle (when outside is hidden). */
  private clip = new Graphics()
  private baseSize = ""
  private last: SceneState | null = null
  /** Set while an export renders: the look it asks for, over the live state. */
  private exporting: { pxPerTile: number; look: ExportLook } | null = null
  private unsubscribe: () => void
  /** What the map's look was last drawn from, and whether it changed since (takeContentChanged). */
  private contentKey: unknown[] | null = null
  private contentChanged = true
  /** Stops following the texture cache in use (see useAssets). */
  private unsubAssets: () => void
  /** Redraw what was waiting for textures or fonts. */
  private retry = () => {
    if (!this.last) return
    this.update(this.last, true)
    this.dirty()
  }

  constructor(
    private renderer: Renderer,
    private assets: AssetCache,
    /** Ask for a repaint: the canvas renders on demand, not every frame. */
    private onDirty: () => void = () => {},
  ) {
    this.content.scale.x = -1
    this.content.sortableChildren = true
    this.shadowLayer.zIndex = zFor(SHADOW_LAYER, 0)
    this.shadowLayer.filters = [this.shadowBlur, this.shadowTint]
    this.shadowLayer.addChild(...SHADOW_KINDS.map((k) => this.shadowKinds[k]))
    this.content.addChild(this.shadowLayer)
    this.base.zIndex = -Infinity
    this.compare.sortableChildren = true
    this.compare.alpha = 0.35
    // Above the bare ground and the reference image, under everything else.
    this.compare.zIndex = -Number.MAX_VALUE / 2
    this.content.addChild(this.base, this.clip, this.compare)
    this.overlay.scale.x = -1
    this.unsubAssets = assets.subscribe(this.retry)
    // A font that finished loading: labels measured and drawn with the
    // fallback meanwhile are redone.
    const unsubFonts = subscribeFonts(() => {
      clearMeasures()
      this.retry()
    })
    this.unsubscribe = () => {
      this.unsubAssets()
      unsubFonts()
    }
  }

  /**
   * Draw with another texture cache (an export at another texture quality,
   * and back): every view is redone with its textures.
   */
  useAssets(assets: AssetCache): void {
    if (assets === this.assets) return
    this.unsubAssets()
    this.assets = assets
    this.unsubAssets = assets.subscribe(this.retry)
    for (const e of this.entities.values()) destroyView(e)
    this.entities.clear()
    for (const c of this.composites.values()) c.comp.dispose()
    this.composites.clear()
    this.lighting?.comp.dispose()
    this.lighting = null
    for (const c of this.compareViews.values()) c.view.destroy({ children: true })
    this.compareViews.clear()
    if (this.last) this.update(this.last)
  }

  /** Whether everything drawn has its textures (nothing waits for one to load). */
  isComplete(): boolean {
    const views = [
      ...this.entities.values(),
      ...this.composites.values(),
      ...this.compareViews.values(),
      ...(this.lighting ? [this.lighting] : []),
    ]
    return views.every((v) => v.complete)
  }

  /** A render env that records texture misses into `track.complete`. */
  private env(
    state: SceneState,
    track: { complete: boolean },
    portals: readonly MapEntity[] = [],
    shadows: Container[] | null = null,
    lightBlockers: readonly MapEntity[] = [],
  ): RenderEnv {
    return {
      tex: (id, req) => {
        if (!id) return undefined
        const t = this.assets.texture(id, req)
        if (!t && !this.assets.isUnavailable(id, req)) track.complete = false
        return t
      },
      size: (id) => {
        if (!id) return undefined
        const s = this.assets.size(id)
        if (!s && !this.assets.isMissing(id)) track.complete = false
        return s
      },
      outline: (id) => {
        const o = this.assets.outline(id)
        if (!o && !this.assets.isUnavailable(id)) track.complete = false
        return o
      },
      colorable: (id) => !!id && this.assets.isColorable(id),
      image: (url) => {
        const t = this.assets.textureFromUrl(url)
        if (!t && !this.assets.urlFailed(url)) track.complete = false
        return t
      },
      buildingWear: () => {
        const wear = state.map.buildingWear
        if (wear === "none") return undefined
        const url = BUILDING_WEAR_URLS[wear]
        const t = this.assets.textureFromUrl(url)
        if (!t && !this.assets.urlFailed(url)) track.complete = false
        return t
      },
      castShadow: (shadow, kind) => {
        // Editor-only renders (overlay ghosts) cast nothing.
        if (!shadows) return shadow.destroy({ children: true })
        shadows.push(shadow)
        this.shadowKinds[kind].addChild(shadow)
      },
      font: (font) => {
        const { ready, pending } = fontStatus(font)
        if (pending) track.complete = false
        return ready
      },
      perf: state.performance,
      textVisible: state.textVisible,
      lighting: state.lighting,
      terrainSmooth: state.terrainSmooth,
      showCaveBlast: state.showCaveBlast,
      portals,
      lightBlockers,
    }
  }

  /** Ask for a repaint, except mid-export (the canvas keeps its last frame meanwhile). */
  private dirty(): void {
    if (!this.exporting) this.onDirty()
  }

  /** The state actually drawn: the live one, or with an export's look applied. */
  private drawn(state: SceneState): SceneState {
    if (!this.exporting) return state
    const { look } = this.exporting
    return {
      ...state,
      lighting: look.lighting,
      shadows: look.shadows,
      postProcess: look.postProcess ? state.postProcess : DEFAULT_POST_PROCESS,
      showOutside: false,
      compareLevel: null,
      showCaveBlast: false,
      performance: look.quality ? PRESET_SETTINGS[look.quality] : state.performance,
    }
  }

  /**
   * Whether the map itself (not the editor overlay: drafts, selection,
   * cursor, guides) may look different since the last call. Lets the canvas
   * keep a picture of the map and redraw only the overlay when that's all
   * that changed (MapLayerCache).
   */
  takeContentChanged(): boolean {
    const changed = this.contentChanged
    this.contentChanged = false
    return changed
  }

  /**
   * Whether a drawn view must be redrawn: it was waiting for textures that
   * may have arrived, or the cache was told its files changed (an edited
   * asset of a user pack) and every view may show old pixels.
   */
  private redraws(view: { complete: boolean }, assetsChanged: boolean): boolean {
    return this.reloading || (assetsChanged && !view.complete)
  }

  /** The cache's epoch when last drawn (see AssetCache.forget). */
  private assetEpoch = 0
  private reloading = false

  update(live: SceneState, assetsChanged = false): void {
    this.last = live
    this.reloading = this.assets.epoch !== this.assetEpoch
    this.assetEpoch = this.assets.epoch
    const state = this.drawn(live)
    // Everything the map's own look comes from (the overlay's inputs left out).
    const contentKey = [
      state.map,
      state.level,
      state.lighting,
      state.shadows,
      state.showOutside,
      state.shadowStyle,
      state.postProcess,
      state.textVisible,
      state.editingText,
      state.terrainEnabled,
      state.terrainSmooth,
      state.showCaveBlast,
      state.compareLevel,
      state.zoom,
      state.referenceUrl,
      state.performance,
      liveTerrainVersion(),
      this.exporting,
      this.assets,
    ]
    if (
      assetsChanged ||
      this.reloading ||
      !this.contentKey ||
      !sameInputs(this.contentKey, contentKey)
    ) {
      this.contentChanged = true
    }
    this.contentKey = contentKey
    const onLevel = state.map.entities.filter((e) => !e.level || e.level === state.level)
    this.syncBounds(state)
    this.syncReference(state)
    this.applyShadowStyle(state)
    this.applyPostProcess(state)
    this.syncEntities(state, onLevel, assetsChanged)
    this.syncCompare(state, assetsChanged)
    this.syncComposites(state, onLevel, assetsChanged)
    this.syncLighting(state, onLevel, assetsChanged)
    const byId = new Map(onLevel.map((e) => [e.id, e]))
    const selected = state.selection.flatMap((id) => byId.get(id) ?? [])
    const track = { complete: true }
    drawOverlay(
      this.overlay,
      [
        ...state.draft,
        ...(state.guide
          ? [
              {
                kind: "guide" as const,
                point: state.guide,
                width: state.map.width,
                height: state.map.height,
              },
            ]
          : []),
      ],
      selected,
      (id) => this.assets.size(id),
      state.zoom,
      this.env(state, track),
      state.transformHandles,
    )
  }

  private applyShadowStyle(state: SceneState): void {
    const style = state.shadowStyle
    this.shadowLayer.visible = state.shadows && style.opacity > 0
    // Content space isn't mirrored: +x is right, +y is down on screen.
    this.shadowLayer.position.set(style.offsetX, style.offsetY)
    this.shadowTint.setStyle(style.color, style.opacity)
    for (const k of SHADOW_KINDS) this.shadowKinds[k].visible = style[k]
    // Blur works in output pixels, so convert the tile radius at the current scale.
    const px = this.shadowPxPerTile ?? tileSizeForZoom(state.zoom)
    this.shadowBlur.strength = style.blur * px
    // Settings › Performance: fewer blur passes, or none (hard edges).
    const quality = state.performance.shadowBlurQuality
    if (quality > 0) this.shadowBlur.quality = quality
    const blur = quality > 0 && style.blur > 0
    if (blur !== this.shadowLayer.filters?.includes(this.shadowBlur)) {
      this.shadowLayer.filters = blur ? [this.shadowBlur, this.shadowTint] : [this.shadowTint]
    }
  }

  private syncCompare(state: SceneState, assetsChanged: boolean): void {
    const below = state.compareLevel
      ? state.map.entities.filter((e) => e.level === state.compareLevel)
      : []
    const seen = new Set<string>()
    below.forEach((entity, index) => {
      const render = ENTITY_RENDERERS[entity.toolId]
      if (!render) return
      seen.add(entity.id)
      const current = this.compareViews.get(entity.id)
      if (current?.entity !== entity || this.redraws(current, assetsChanged)) {
        current?.view.destroy({ children: true })
        const track = { complete: true }
        // No shadows: a faded level casting shadows on the active one would mislead.
        const view = render(entity, { ...this.env(state, track), castShadow: (s) => s.destroy() })
        this.compare.addChild(view)
        this.compareViews.set(entity.id, { entity, view, complete: track.complete })
      }
      const entry = this.compareViews.get(entity.id)
      if (!entry) return
      entry.view.zIndex = zFor(drawLayer(entity), index)
    })
    for (const [id, entry] of this.compareViews) {
      if (seen.has(id)) continue
      entry.view.destroy({ children: true })
      this.compareViews.delete(id)
    }
  }

  /** One filter pass over the map content, only while something is adjusted. */
  private applyPostProcess(state: SceneState): void {
    const pp = state.postProcess
    if (isNeutral(pp)) {
      if (this.content.filters) this.content.filters = null
      return
    }
    this.post.set(pp)
    if (!this.content.filters) this.content.filters = [this.post]
  }

  /** Black ground under the map, and clipping of whatever spills past it. */
  private syncBounds(state: SceneState): void {
    const { width, height } = state.map
    const size = `${width}x${height}:${state.showOutside}`
    if (size === this.baseSize) return
    this.baseSize = size
    // Content space: the map spans x ∈ [−width, 0].
    this.base.clear().rect(-width, 0, width, height).fill({ color: MAP_GROUND_COLOR })
    // The mask stays set (swapping a child mask on and off is fragile); showing
    // the outside just widens it far past anything a map holds.
    const pad = state.showOutside ? 1e5 : 0
    this.clip
      .clear()
      .rect(-width - pad, -pad, width + 2 * pad, height + 2 * pad)
      .fill({ color: 0xffffff })
    this.content.mask = this.clip
  }

  private syncReference(state: SceneState): void {
    const url = state.referenceUrl
    const img = state.map.referenceImage
    if (!url || !img || !img.visible) {
      this.reference?.sprite.destroy()
      this.reference = null
      return
    }
    if (this.reference?.url !== url) {
      this.reference?.sprite.destroy()
      const tex = this.assets.textureFromUrl(url)
      if (!tex) {
        this.reference = null
        return
      }
      const sprite = new Sprite(tex)
      // Just above the bare ground (which is at −Infinity).
      sprite.zIndex = -Number.MAX_VALUE
      this.content.addChild(sprite)
      this.reference = { url, sprite }
    }
    const { sprite } = this.reference
    const aspect = sprite.texture.height / sprite.texture.width
    sprite.width = img.width
    sprite.height = img.width * aspect
    // Position is the top-left corner in map space; x is mirrored.
    sprite.position.set(-img.position.x - img.width, img.position.y)
    sprite.alpha = img.opacity
    // An editor aid, never exported.
    sprite.visible = !this.exporting
  }

  private syncEntities(state: SceneState, onLevel: MapEntity[], assetsChanged: boolean): void {
    const seen = new Set<string>()
    const portals = onLevel.filter((e) => e.toolId === "portal")
    // Lights are cut by what blocks light: they redraw when any of it changes.
    const blockers = lightBlockers(onLevel)
    // A view-level alpha, so changing the ambient doesn't rebuild every light.
    const glow = glowStrength(state.map.environment.ambientLight)
    onLevel.forEach((entity, index) => {
      const render = ENTITY_RENDERERS[entity.toolId]
      if (!render) return
      seen.add(entity.id)
      const deps = entity.toolId === "wall" ? portals : entity.toolId === "light" ? blockers : []
      const current = this.entities.get(entity.id)
      const inputsSame =
        !!current &&
        sameInputs(current.deps, deps) &&
        current.textVisible === state.textVisible &&
        current.lighting === state.lighting &&
        current.wear === state.map.buildingWear &&
        current.textQuality === state.performance.textQuality &&
        !this.redraws(current, assetsChanged)
      // Only moved (dragging an object, a label, a light): shift what's drawn.
      if (
        current &&
        inputsSame &&
        current.entity !== entity &&
        // A light's shadows depend on where it is: it's redrawn.
        entity.toolId !== "light" &&
        onlyMoved(current.entity, entity)
      ) {
        shiftView(
          current,
          entity.position.x - current.entity.position.x,
          entity.position.y - current.entity.position.y,
        )
        current.entity = entity
      }
      const stale = !current || !inputsSame || current.entity !== entity
      if (stale) {
        if (current) destroyView(current)
        const track = { complete: true }
        const shadows: Container[] = []
        const view = render(entity, this.env(state, track, portals, shadows, blockers))
        this.content.addChild(view)
        this.entities.set(entity.id, {
          entity,
          deps,
          textVisible: state.textVisible,
          lighting: state.lighting,
          wear: state.map.buildingWear,
          textQuality: state.performance.textQuality,
          view,
          shadows,
          complete: track.complete,
        })
      }
      const entry = this.entities.get(entity.id)
      if (!entry) return
      entry.view.zIndex = zFor(drawLayer(entity), index)
      if (entity.toolId === "light") entry.view.alpha = glow
      if (entity.toolId === "text") {
        entry.view.visible = state.textVisible && entity.id !== state.editingText
      }
    })
    for (const [id, entry] of this.entities) {
      if (seen.has(id)) continue
      destroyView(entry)
      this.entities.delete(id)
    }
  }

  private syncComposites(state: SceneState, onLevel: MapEntity[], assetsChanged: boolean): void {
    const wanted = new Set<string>()
    for (const [toolId, build] of Object.entries(PAINTED_COMPOSITES)) {
      const enabled = toolId !== "terrainBrush" || state.terrainEnabled
      if (!enabled) continue
      const groups = paintedGroups(
        toolId,
        onLevel.filter((e) => e.toolId === toolId),
      )
      for (const { key, entities: mine } of groups) {
        wanted.add(key)
        const current = this.composites.get(key)
        const inputs = [
          state.map.width,
          state.map.height,
          state.terrainSmooth,
          state.showCaveBlast,
          state.map.buildingWear,
          state.performance.maskDetail,
          state.performance.terrainResolution,
          state.performance.waterEffect,
          ...mine,
        ]
        if (
          current &&
          sameInputs(current.inputs, inputs) &&
          !this.redraws(current, assetsChanged)
        ) {
          // Same document, but a stroke in progress may have painted since.
          const live = liveTerrainVersion()
          if (current.live !== live) {
            current.comp.refresh?.()
            current.live = live
          }
          continue
        }
        current?.comp.dispose()
        const track = { complete: true }
        const comp = build(mine, state.map, this.renderer, this.env(state, track))
        if (this.exporting) comp.setDirect?.(true)
        comp.view.zIndex = zFor(paintedLayer(toolId, mine), -1)
        this.content.addChild(comp.view)
        this.composites.set(key, {
          toolId,
          inputs,
          comp,
          complete: track.complete,
          live: liveTerrainVersion(),
        })
      }
    }
    for (const [key, current] of this.composites) {
      if (wanted.has(key)) continue
      current.comp.dispose()
      this.composites.delete(key)
    }
  }

  private syncLighting(state: SceneState, onLevel: MapEntity[], assetsChanged: boolean): void {
    const lights = onLevel.filter((e) => e.toolId === "light")
    const ambient = state.map.environment.ambientLight
    if (!state.lighting) {
      this.lighting?.comp.dispose()
      this.lighting = null
      return
    }
    const blockers = lightBlockers(onLevel)
    const softness = state.shadowStyle.lightSoftness
    const { maskDetail, lightBlurQuality } = state.performance
    const inputs = [
      state.map.width,
      state.map.height,
      ambient,
      softness,
      maskDetail,
      lightBlurQuality,
      lights.length,
      ...lights,
      ...blockers,
    ]
    const current = this.lighting
    if (current && sameInputs(current.inputs, inputs) && !this.redraws(current, assetsChanged))
      return
    current?.comp.dispose()
    const track = { complete: true }
    const comp = lightingComposite(
      lights,
      ambient,
      softness,
      { maskDetail, blurQuality: lightBlurQuality },
      state.map,
      this.renderer,
      this.env(state, track, [], null, blockers),
    )
    comp.view.zIndex = Number.MAX_SAFE_INTEGER
    this.content.addChild(comp.view)
    this.lighting = { toolId: "light", inputs, comp, complete: track.complete, live: 0 }
  }

  /**
   * Switch to an export's look at `pxPerTile` until {@link endExport}:
   * lighting, shadows, color adjustments and the ground as asked, editor
   * aids (reference image, compared level, what's past the edges) hidden,
   * and the shadow blur sized for the export's scale instead of the zoom.
   * The on-screen canvas isn't repainted meanwhile.
   */
  beginExport(pxPerTile: number, look: ExportLook): void {
    this.exporting = { pxPerTile, look }
    for (const c of this.composites.values()) c.comp.setDirect?.(true)
    this.shadowPxPerTile = pxPerTile
    this.base.visible = !look.transparent
    if (this.last) this.update(this.last)
  }

  endExport(): void {
    if (!this.exporting) return
    this.exporting = null
    for (const c of this.composites.values()) c.comp.setDirect?.(false)
    this.shadowPxPerTile = null
    this.base.visible = true
    if (this.last) this.update(this.last)
    this.onDirty()
  }

  /**
   * The parts of what's drawn that can be switched off one at a time, to
   * measure what each costs (Settings › Performance's measurement,
   * perfProfile.ts). `show(false)` hides the part; `show(true)` puts it back
   * as it was.
   */
  profileParts(): ProfilePart[] {
    const parts: ProfilePart[] = []
    const toggle = (id: string, labelKey: string, items: Container[], tool?: string) => {
      if (items.length === 0) return
      const was = items.map((c) => c.visible)
      parts.push({
        id,
        labelKey,
        tool,
        show: (on) => items.forEach((c, i) => (c.visible = on ? was[i] : false)),
      })
    }
    if (this.shadowLayer.visible) {
      toggle("shadows", "perf.part.shadows", [this.shadowLayer])
      const filters = [...this.shadowLayer.filters]
      if (filters.includes(this.shadowBlur)) {
        parts.push({
          id: "shadowBlur",
          labelKey: "perf.part.shadowBlur",
          show: (on) => {
            this.shadowLayer.filters = on ? filters : [this.shadowTint]
          },
        })
      }
    }
    if (this.lighting) toggle("lighting", "perf.part.lighting", [this.lighting.comp.view])
    const post = this.content.filters ? [...this.content.filters] : []
    if (post.length) {
      parts.push({
        id: "postProcess",
        labelKey: "perf.part.postProcess",
        show: (on) => {
          this.content.filters = on ? post : null
        },
      })
    }
    const clip = this.content.mask
    if (clip) {
      parts.push({
        id: "clip",
        labelKey: "perf.part.clip",
        show: (on) => {
          this.content.mask = on ? clip : null
        },
      })
    }
    const painted = new Map<string, Container[]>()
    for (const c of this.composites.values()) {
      painted.set(c.toolId, [...(painted.get(c.toolId) ?? []), c.comp.view])
    }
    for (const [tool, views] of painted) toggle(`painted:${tool}`, "perf.part.tool", views, tool)
    const byTool = new Map<string, Container[]>()
    for (const e of this.entities.values()) {
      const tool = e.entity.toolId
      byTool.set(tool, [...(byTool.get(tool) ?? []), e.view])
    }
    for (const [tool, views] of byTool) toggle(`entities:${tool}`, "perf.part.tool", views, tool)
    if (this.compare.children.length) toggle("compare", "perf.part.compare", [this.compare])
    if (this.reference) toggle("reference", "perf.part.reference", [this.reference.sprite])
    toggle("overlay", "perf.part.overlay", [this.overlay])
    return parts
  }

  /** Bring screen caches (the terrain) up to date: call right before rendering the screen. */
  prerender(): void {
    for (const c of this.composites.values()) c.comp.prerender?.()
  }

  destroy(): void {
    this.unsubscribe()
    for (const e of this.entities.values()) destroyView(e)
    this.shadowBlur.destroy()
    this.shadowTint.destroy()
    this.post.destroy()
    for (const c of this.composites.values()) c.comp.dispose()
    this.lighting?.comp.dispose()
    this.reference?.sprite.destroy()
    this.content.destroy({ children: true })
    this.overlay.destroy({ children: true })
  }
}
