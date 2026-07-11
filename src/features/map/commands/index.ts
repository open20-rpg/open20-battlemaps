import { useMapStore } from "../../../stores/mapStore"
import { useMapFileStore } from "../../../stores/mapFileStore"
import { createDocument, type MapDocument, type MapEntity } from "../model/types"

/**
 * Commands are the ONLY way to mutate the map document. Each command is a
 * named, whole-document transition executed through the store, which is what
 * gives us undo/redo (zundo snapshots every transition), a single place for
 * the dirty flag (see mapFileStore), and a stable API for tool behaviors.
 *
 * Add new mutations here (addEntity, moveEntities, …) — never call
 * `useMapStore.setState` from components or behaviors.
 */

export function createMap(width: number, height: number): void {
  useMapStore.setState({ map: createDocument(width, height) })
  // A fresh document starts with a clean history.
  useMapStore.temporal.getState().clear()
  useMapFileStore.getState().startNew()
}

/** Replace the document with one loaded from disk (see features/map/io.ts). */
export function loadMap(doc: MapDocument): void {
  useMapStore.setState({ map: doc })
  useMapStore.temporal.getState().clear()
}

export function closeMap(): void {
  useMapStore.setState({ map: null })
  useMapStore.temporal.getState().clear()
  useMapFileStore.getState().clearFile()
}

/** Insert an entity. The id must be unique (caller generates it). */
export function addEntity(entity: MapEntity): void {
  useMapStore.setState((s) => {
    if (!s.map) return s
    return { map: { ...s.map, entities: [...s.map.entities, entity] } }
  })
  useMapFileStore.getState().markDirty()
}

export function removeEntities(ids: readonly string[]): void {
  const drop = new Set(ids)
  useMapStore.setState((s) => {
    if (!s.map) return s
    return { map: { ...s.map, entities: s.map.entities.filter((e) => !drop.has(e.id)) } }
  })
  useMapFileStore.getState().markDirty()
}

// -- history ---------------------------------------------------------------

export function undo(): void {
  useMapStore.temporal.getState().undo()
  useMapFileStore.getState().markDirty()
}

export function redo(): void {
  useMapStore.temporal.getState().redo()
  useMapFileStore.getState().markDirty()
}

export function canUndo(): boolean {
  return useMapStore.temporal.getState().pastStates.length > 0
}

export function canRedo(): boolean {
  return useMapStore.temporal.getState().futureStates.length > 0
}
