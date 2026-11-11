import { Container, Sprite, type Renderer } from "pixi.js"
import { type DraftShape } from "../../../stores/editorStore"
import { type MapDocument, type MapEntity } from "../model/types"
import { type AssetCache } from "./assets"
import { ENTITY_RENDERERS, type RenderEnv } from "./entities"
import { lightingComposite } from "./lighting"
import { drawOverlay } from "./overlay"
import { PAINTED_COMPOSITES, paintedLayer, type Composite } from "./painted"

/** Everything the scene draws from, gathered from the stores each frame it changes. */
export interface SceneState {
  map: MapDocument
  level: string | null
  lighting: boolean
  shadows: boolean
  textVisible: boolean
  terrainEnabled: boolean
  draft: readonly DraftShape[]
  selection: readonly string[]
  zoom: number
  /** Reference image as a loaded data URL (null when none/hidden). */
  referenceUrl: string | null
}

interface EntityView {
  entity: MapEntity
  /** Other entities the view depends on (walls: the level's portals). */
  deps: readonly unknown[]
  /** Render inputs that, if changed, require a redraw. */
  shadows: boolean
  textVisible: boolean
  view: Container
  /** False when a texture was still loading — redraw once assets arrive. */
  complete: boolean
}

interface CompositeView {
  inputs: readonly unknown[]
  comp: Composite
  complete: boolean
}

const sameInputs = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v, i) => v === b[i])

/** Draw order: layer bucket first, then document order within it. */
const zFor = (layer: number, index: number) => (layer + 1000) * 100000 + index

/**
 * The imperative map renderer: owns the Pixi display tree for the document
 * and reconciles it against store state (`update`), redrawing only what
 * changed. Entities are immutable in the store, so reference equality tells
 * us exactly which ones need a new view. Painted tools and lighting are
 * composites rebuilt when any of their inputs change.
 */
export class MapScene {
  /** Map content, un-mirrored (scale.x = -1) — see entities.ts. */
  readonly content = new Container()
  /** Editor overlay (drafts, selection); above the grid. */
  readonly overlay = new Container()
  private entities = new Map<string, EntityView>()
  private composites = new Map<string, CompositeView>()
  private lighting: CompositeView | null = null
  private reference: { url: string; sprite: Sprite } | null = null
  private last: SceneState | null = null
  private unsubscribe: () => void

  constructor(
    private renderer: Renderer,
    private assets: AssetCache,
  ) {
    this.content.scale.x = -1
    this.content.sortableChildren = true
    this.overlay.scale.x = -1
    this.unsubscribe = assets.subscribe(() => {
      if (this.last) this.update(this.last, true)
    })
  }

  /** A render env that records texture misses into `track.complete`. */
  private env(
    state: SceneState,
    track: { complete: boolean },
    portals: readonly MapEntity[] = [],
  ): RenderEnv {
    return {
      tex: (id, req) => {
        if (!id) return undefined
        const t = this.assets.texture(id, req)
        if (!t && !this.assets.isMissing(id)) track.complete = false
        return t
      },
      size: (id) => {
        if (!id) return undefined
        const s = this.assets.size(id)
        if (!s && !this.assets.isMissing(id)) track.complete = false
        return s
      },
      shadows: state.shadows,
      textVisible: state.textVisible,
      portals,
    }
  }

  update(state: SceneState, assetsChanged = false): void {
    this.last = state
    const onLevel = state.map.entities.filter((e) => !e.level || e.level === state.level)
    this.syncReference(state)
    this.syncEntities(state, onLevel, assetsChanged)
    this.syncComposites(state, onLevel, assetsChanged)
    this.syncLighting(state, onLevel, assetsChanged)
    const byId = new Map(onLevel.map((e) => [e.id, e]))
    const selected = state.selection.flatMap((id) => byId.get(id) ?? [])
    const track = { complete: true }
    drawOverlay(
      this.overlay,
      state.draft,
      selected,
      (id) => this.assets.size(id),
      state.zoom,
      this.env(state, track),
    )
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
      sprite.zIndex = -Infinity
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
  }

  private syncEntities(state: SceneState, onLevel: MapEntity[], assetsChanged: boolean): void {
    const seen = new Set<string>()
    const portals = onLevel.filter((e) => e.toolId === "portal")
    onLevel.forEach((entity, index) => {
      const render = ENTITY_RENDERERS[entity.toolId]
      if (!render) return
      seen.add(entity.id)
      const deps = entity.toolId === "wall" ? portals : []
      const current = this.entities.get(entity.id)
      const stale =
        !current ||
        current.entity !== entity ||
        !sameInputs(current.deps, deps) ||
        current.shadows !== state.shadows ||
        current.textVisible !== state.textVisible ||
        (assetsChanged && !current.complete)
      if (stale) {
        current?.view.destroy({ children: true })
        const track = { complete: true }
        const view = render(entity, this.env(state, track, portals))
        this.content.addChild(view)
        this.entities.set(entity.id, {
          entity,
          deps,
          shadows: state.shadows,
          textVisible: state.textVisible,
          view,
          complete: track.complete,
        })
      }
      const entry = this.entities.get(entity.id)
      if (entry) entry.view.zIndex = zFor(entity.layer, index)
    })
    for (const [id, entry] of this.entities) {
      if (seen.has(id)) continue
      entry.view.destroy({ children: true })
      this.entities.delete(id)
    }
  }

  private syncComposites(state: SceneState, onLevel: MapEntity[], assetsChanged: boolean): void {
    for (const [toolId, build] of Object.entries(PAINTED_COMPOSITES)) {
      const mine = onLevel.filter((e) => e.toolId === toolId)
      const enabled = toolId !== "terrainBrush" || state.terrainEnabled
      const current = this.composites.get(toolId)
      if (mine.length === 0 || !enabled) {
        if (current) {
          current.comp.dispose()
          this.composites.delete(toolId)
        }
        continue
      }
      const inputs = [state.map.width, state.map.height, ...mine]
      if (current && sameInputs(current.inputs, inputs) && !(assetsChanged && !current.complete)) {
        continue
      }
      current?.comp.dispose()
      const track = { complete: true }
      const comp = build(mine, state.map, this.renderer, this.env(state, track))
      comp.view.zIndex = zFor(paintedLayer(toolId, mine), -1)
      this.content.addChild(comp.view)
      this.composites.set(toolId, { inputs, comp, complete: track.complete })
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
    const inputs = [state.map.width, state.map.height, ambient, ...lights]
    const current = this.lighting
    if (current && sameInputs(current.inputs, inputs) && !(assetsChanged && !current.complete))
      return
    current?.comp.dispose()
    const track = { complete: true }
    const comp = lightingComposite(
      lights,
      ambient,
      state.map,
      this.renderer,
      this.env(state, track),
    )
    comp.view.zIndex = Number.MAX_SAFE_INTEGER
    this.content.addChild(comp.view)
    this.lighting = { inputs, comp, complete: track.complete }
  }

  /** Run `fn` with editor-only content (the reference image) hidden — for exports. */
  withoutEditorAids<T>(fn: () => T): T {
    const ref = this.reference?.sprite
    const was = ref?.visible
    if (ref) ref.visible = false
    try {
      return fn()
    } finally {
      if (ref && was !== undefined) ref.visible = was
    }
  }

  destroy(): void {
    this.unsubscribe()
    for (const e of this.entities.values()) e.view.destroy({ children: true })
    for (const c of this.composites.values()) c.comp.dispose()
    this.lighting?.comp.dispose()
    this.reference?.sprite.destroy()
    this.content.destroy({ children: true })
    this.overlay.destroy({ children: true })
  }
}
