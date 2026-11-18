import { useMapStore } from "../../../stores/mapStore"
import { resizeTerrain, type TerrainData } from "../model/terrain"
import { useMapFileStore } from "../../../stores/mapFileStore"
import { useToolsStore } from "../../../stores/toolsStore"
import { useViewStore } from "../../../stores/viewStore"
import { useEditorStore } from "../../../stores/editorStore"
import { translateEntity } from "../model/geometry"
import { replaceAssetIn } from "../missingAssets"
import {
  createDocument,
  DEFAULT_BUILDING_WEAR,
  normalizeDocument,
  type BuildingWear,
  type MapDocument,
  type MapEntity,
  type MapEnvironment,
  type MapLevel,
  type ReferenceImage,
  type Vec2,
} from "../model/types"

/**
 * Commands are the ONLY way to mutate the map document. Each command is a
 * named, whole-document transition executed through the store, which is what
 * gives us undo/redo (zundo snapshots every transition), a single place for
 * the dirty flag (see mapFileStore), and a stable API for tool behaviors.
 *
 * Add new mutations here — never call `useMapStore.setState` from components
 * or behaviors.
 */

/** Apply a document transition (no-op without an open map) and mark the file dirty. */
function edit(fn: (map: MapDocument) => MapDocument): void {
  const map = useMapStore.getState().map
  if (!map) return
  const next = fn(map)
  if (next === map) return
  useMapStore.setState({ map: next })
  useMapFileStore.getState().markDirty()
}

export function createMap(
  width: number,
  height: number,
  buildingWear: BuildingWear = DEFAULT_BUILDING_WEAR,
): void {
  const doc = createDocument(width, height, buildingWear)
  useMapStore.setState({ map: doc })
  // A fresh document starts with a clean history.
  useMapStore.temporal.getState().clear()
  useMapFileStore.getState().startNew()
  // A new map is a blank slate: drop the previous map's tool selection/params
  // (e.g. a terrain texture slot) and view overlays (zoom, grid, snap, …)
  // rather than carrying them over.
  useToolsStore.getState().resetAll()
  useViewStore.getState().reset()
  useEditorStore.getState().reset(doc.levels[0].id)
}

/**
 * Add what a just-created document starts with (e.g. its terrain): part of
 * its baseline, so neither an undo step nor an unsaved change. Only while
 * `doc` is still untouched; once edited, they're added as a normal edit.
 */
export function addInitialEntities(doc: MapDocument, entities: readonly MapEntity[]): void {
  if (entities.length === 0) return
  if (useMapStore.getState().map !== doc) return addEntities(entities, true)
  useMapStore.setState({ map: { ...doc, entities: [...entities, ...doc.entities] } })
  useMapStore.temporal.getState().clear()
}

/** Replace the document with one loaded from disk (see features/map/io.ts). */
export function loadMap(doc: MapDocument): void {
  const normalized = normalizeDocument(doc)
  useMapStore.setState({ map: normalized })
  useMapStore.temporal.getState().clear()
  useEditorStore.getState().reset(normalized.levels[0].id)
}

export function closeMap(): void {
  useMapStore.setState({ map: null })
  useMapStore.temporal.getState().clear()
  useMapFileStore.getState().clearFile()
  useEditorStore.getState().reset(null)
}

// -- entities ----------------------------------------------------------------

/** Insert an entity. The id must be unique (caller generates it). */
export function addEntity(entity: MapEntity): void {
  addEntities([entity])
}

/**
 * Insert entities. `under` places them at the bottom of their layer's draw
 * order instead of on top (the tools' "Sorting: Under" option).
 */
export function addEntities(entities: readonly MapEntity[], under = false): void {
  if (entities.length === 0) return
  edit((map) => ({
    ...map,
    entities: under ? [...entities, ...map.entities] : [...map.entities, ...entities],
  }))
}

export function removeEntities(ids: readonly string[]): void {
  if (ids.length === 0) return
  const drop = new Set(ids)
  edit((map) => {
    const entities = map.entities.filter((e) => !drop.has(e.id))
    return entities.length === map.entities.length ? map : { ...map, entities }
  })
  useEditorStore.getState().deselect(ids)
}

/** Replace fields of existing entities (by id). Unknown ids are ignored. */
export function updateEntities(patches: ReadonlyMap<string, Partial<MapEntity>>): void {
  if (patches.size === 0) return
  edit((map) => ({
    ...map,
    entities: map.entities.map((e) => {
      const patch = patches.get(e.id)
      return patch ? { ...e, ...patch, id: e.id } : e
    }),
  }))
}

export function updateEntity(id: string, patch: Partial<MapEntity>): void {
  updateEntities(new Map([[id, patch]]))
}

/**
 * Point every use of asset `from` at `to` (Replace Assets): in all entities,
 * or only in `entityIds`. One undo step.
 */
export function replaceAsset(from: string, to: string, entityIds?: readonly string[]): void {
  if (from === to) return
  const only = entityIds ? new Set(entityIds) : null
  edit((map) => {
    let changed = false
    const entities = map.entities.map((e) => {
      if (only && !only.has(e.id)) return e
      const next = replaceAssetIn(e, from, to)
      if (next !== e) changed = true
      return next
    })
    return changed ? { ...map, entities } : map
  })
}

/** Move entities by a delta (in tiles). */
export function moveEntities(ids: readonly string[], delta: Vec2): void {
  if (ids.length === 0 || (delta.x === 0 && delta.y === 0)) return
  const move = new Set(ids)
  edit((map) => ({
    ...map,
    entities: map.entities.map((e) => (move.has(e.id) ? translateEntity(e, delta) : e)),
  }))
}

// -- map-wide settings -------------------------------------------------------

export function setEnvironment(patch: Partial<MapEnvironment>): void {
  edit((map) => ({ ...map, environment: { ...map.environment, ...patch } }))
}

/** The map's building wear (Map Settings). */
export function setBuildingWear(buildingWear: BuildingWear): void {
  edit((map) => ({ ...map, buildingWear }))
}

export function setReferenceImage(image: ReferenceImage | null): void {
  edit((map) => ({ ...map, referenceImage: image }))
}

export function updateReferenceImage(patch: Partial<ReferenceImage>): void {
  edit((map) =>
    map.referenceImage ? { ...map, referenceImage: { ...map.referenceImage, ...patch } } : map,
  )
}

export function resizeMap(width: number, height: number): void {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  edit((map) => {
    if (map.width === w && map.height === h) return map
    // Terrain splats follow the map's size (new area in slot 1).
    const entities = map.entities.map((e) =>
      e.params.terrain
        ? {
            ...e,
            params: {
              ...e.params,
              terrain: resizeTerrain(e.params.terrain as TerrainData, { width: w, height: h }),
            },
          }
        : e,
    )
    return { ...map, width: w, height: h, entities }
  })
}

// -- levels ------------------------------------------------------------------

export function addLevel(level: MapLevel): void {
  edit((map) => ({ ...map, levels: [...map.levels, level] }))
  useEditorStore.getState().setActiveLevel(level.id)
}

export function renameLevel(id: string, name: string): void {
  edit((map) => ({
    ...map,
    levels: map.levels.map((l) => (l.id === id ? { ...l, name } : l)),
  }))
}

/** Remove a level and everything on it. The last remaining level can't be removed. */
export function removeLevel(id: string): void {
  const map = useMapStore.getState().map
  if (!map || map.levels.length <= 1) return
  edit((m) => ({
    ...m,
    levels: m.levels.filter((l) => l.id !== id),
    entities: m.entities.filter((e) => e.level !== id),
  }))
  const editor = useEditorStore.getState()
  if (editor.activeLevel === id) {
    editor.setActiveLevel(useMapStore.getState().map?.levels[0]?.id ?? null)
  }
}

/** Move a level one step up (+1) or down (-1) in the stacking order. */
export function moveLevel(id: string, dir: 1 | -1): void {
  edit((map) => {
    const i = map.levels.findIndex((l) => l.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= map.levels.length) return map
    const levels = map.levels.slice()
    ;[levels[i], levels[j]] = [levels[j], levels[i]]
    return { ...map, levels }
  })
}

// -- gestures ----------------------------------------------------------------

let gestureStart: MapDocument | null | undefined

/**
 * Group every command issued until {@link endGesture} into a single undo step
 * (e.g. a brush stroke or a drag-move that updates the document live on every
 * pointer move). History tracking is paused meanwhile; on end the pre-gesture
 * document is recorded as one past state.
 */
export function beginGesture(): void {
  if (gestureStart !== undefined) return
  gestureStart = useMapStore.getState().map
  useMapStore.temporal.getState().pause()
}

export function endGesture(): void {
  if (gestureStart === undefined) return
  const before = gestureStart
  gestureStart = undefined
  const after = useMapStore.getState().map
  const temporal = useMapStore.temporal.getState()
  if (after === before) {
    temporal.resume()
    return
  }
  // Rewind (untracked) to the pre-gesture state, then re-apply the result
  // tracked, so history holds exactly one entry for the whole gesture.
  useMapStore.setState({ map: before })
  temporal.resume()
  useMapStore.setState({ map: after })
}

/** Abort a gesture, restoring the document to where it started. */
export function cancelGesture(): void {
  if (gestureStart === undefined) return
  const before = gestureStart
  gestureStart = undefined
  useMapStore.setState({ map: before })
  useMapStore.temporal.getState().resume()
}

// -- history -----------------------------------------------------------------

export function undo(): void {
  if (!canUndo()) return
  useMapStore.temporal.getState().undo()
  useMapFileStore.getState().markDirty()
  pruneSelection()
}

export function redo(): void {
  if (!canRedo()) return
  useMapStore.temporal.getState().redo()
  useMapFileStore.getState().markDirty()
  pruneSelection()
}

export function canUndo(): boolean {
  return useMapStore.temporal.getState().pastStates.length > 0
}

export function canRedo(): boolean {
  return useMapStore.temporal.getState().futureStates.length > 0
}

/** Drop selected ids that no longer exist (after undo/redo). */
function pruneSelection(): void {
  const ids = new Set(useMapStore.getState().map?.entities.map((e) => e.id))
  const editor = useEditorStore.getState()
  const stale = editor.selection.filter((id) => !ids.has(id))
  if (stale.length > 0) editor.deselect(stale)
  // A level removed by undo/redo can't stay active.
  const levels = useMapStore.getState().map?.levels ?? []
  if (editor.activeLevel && !levels.some((l) => l.id === editor.activeLevel)) {
    editor.setActiveLevel(levels[0]?.id ?? null)
  }
}
