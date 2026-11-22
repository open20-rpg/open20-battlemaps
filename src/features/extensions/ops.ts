import {
  type ApplyResult,
  type Entity,
  type EntityKind,
  type EntityPatch,
  type Level,
  type MapChange,
  type MapOp,
  type NewEntity,
} from "@open20/battlemaps-sdk"
import {
  flipEntity,
  newId,
  selectionBounds,
  transformEntity,
  translateEntity,
} from "../map/model/geometry"
import { withAttached } from "../map/model/groups"
import {
  DEFAULT_GRID,
  type MapGrid,
  isBuildingWear,
  type MapDocument,
  type MapEntity,
  type Vec2,
} from "../map/model/types"
import { normalizePostProcessPatch } from "../../lib/postProcess"

/**
 * The stable entity view extensions see (sdk/src/types.ts), and the pure
 * functions applying their ops to a document. The app's internal model can
 * change between versions; this adapter is the one place that has to
 * follow it, so extensions keep working.
 */

/** Kinds whose main asset is `params.asset` (and color `params.color`). */
const ASSET_KINDS = new Set(["object", "scatter", "portal", "light"])

/** Layer a new entity of each kind takes when the op doesn't say. */
const DEFAULT_LAYERS: Record<string, number> = {
  object: 100,
  scatter: 100,
  portal: 500,
  wall: 600,
  build: -200,
  path: 100,
  pattern: 100,
  roof: 800,
  light: 700,
  text: 900,
  cave: -300,
  terrainBrush: -500,
  water: 0,
  material: -400,
}

export const isExtensionKind = (kind: string): kind is `ext:${string}` => kind.startsWith("ext:")

/** The extension a kind belongs to (`ext:<id>/<type>`), or null for core kinds. */
export function kindOwner(kind: string): string | null {
  if (!isExtensionKind(kind)) return null
  const slash = kind.indexOf("/")
  return slash > 4 ? kind.slice(4, slash) : null
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)

export function toSdkEntity(e: MapEntity, extId: string, fallbackLevel: string): Entity {
  const asset = ASSET_KINDS.has(e.toolId) ? str(e.params.asset) : undefined
  const color = ASSET_KINDS.has(e.toolId) ? str(e.params.color) : undefined
  return {
    id: e.id,
    kind: e.toolId as EntityKind,
    level: e.level ?? fallbackLevel,
    layer: e.layer,
    position: { ...e.position },
    rotation: e.rotation,
    scale: e.scale ?? 1,
    flipX: !!e.flipX,
    flipY: !!e.flipY,
    ...(e.points ? { points: e.points.map((p) => ({ ...p })), closed: !!e.closed } : {}),
    ...(e.group ? { group: e.group } : {}),
    ...(e.link ? { link: e.link } : {}),
    ...(e.parent ? { parent: e.parent } : {}),
    locked: !!e.locked,
    ...(e.text !== undefined ? { text: e.text } : {}),
    ...(asset ? { asset } : {}),
    ...(color ? { color } : {}),
    data: { ...(e.ext?.[extId] ?? {}) },
    params: e.params,
  }
}

export class OpError extends Error {}

function newEntityToMap(n: NewEntity, extId: string, level: string): MapEntity {
  const owner = kindOwner(n.kind)
  if (isExtensionKind(n.kind) && owner !== extId)
    throw new OpError(`only ${owner ?? "its extension"} can create ${n.kind} entities`)
  if (!isExtensionKind(n.kind) && !(n.kind in DEFAULT_LAYERS))
    throw new OpError(`unknown entity kind ${n.kind}`)
  const params: Record<string, unknown> = { ...(n.params ?? {}) }
  if (ASSET_KINDS.has(n.kind)) {
    if (n.asset !== undefined) params.asset = n.asset
    if (n.color !== undefined) params.color = n.color
  }
  return {
    id: newId(),
    toolId: n.kind,
    layer: n.layer ?? DEFAULT_LAYERS[n.kind] ?? 100,
    level: n.level ?? level,
    position: { x: n.position.x, y: n.position.y },
    rotation: n.rotation ?? 0,
    ...(n.scale !== undefined && n.scale !== 1 ? { scale: n.scale } : {}),
    ...(n.flipX ? { flipX: true } : {}),
    ...(n.flipY ? { flipY: true } : {}),
    ...(n.points ? { points: n.points.map((p) => ({ x: p.x, y: p.y })), closed: !!n.closed } : {}),
    ...(n.text !== undefined ? { text: n.text } : {}),
    ...(n.parent ? { parent: n.parent } : {}),
    ...(n.data && Object.keys(n.data).length ? { ext: { [extId]: { ...n.data } } } : {}),
    params,
  }
}

function patchToMap(e: MapEntity, patch: EntityPatch): MapEntity {
  const { params, asset, color, ...fields } = patch
  const next: MapEntity = { ...e, ...fields }
  if (params || asset !== undefined || color !== undefined) {
    next.params = { ...e.params, ...(params ?? {}) }
    if (ASSET_KINDS.has(e.toolId)) {
      if (asset !== undefined) next.params.asset = asset
      if (color !== undefined) next.params.color = color
    }
  }
  return next
}

function setExt(
  ext: Record<string, Record<string, unknown>> | undefined,
  extId: string,
  data: Record<string, unknown> | null,
): Record<string, Record<string, unknown>> | undefined {
  const next = { ...(ext ?? {}) }
  if (data && Object.keys(data).length) next[extId] = { ...data }
  else delete next[extId]
  return Object.keys(next).length ? next : undefined
}

export interface OpsResult extends ApplyResult {
  map: MapDocument
  change: Omit<MapChange, "history" | "source">
}

/**
 * Apply `ops` to `map` for extension `extId`, purely. Locked entities are
 * skipped (except to lock/unlock); an invalid op throws an OpError and
 * nothing is applied.
 */
export function applyOps(
  map: MapDocument,
  ops: readonly MapOp[],
  extId: string,
  activeLevel: string,
  sizeOf: (id: string) => { w: number; h: number } | undefined = () => undefined,
): OpsResult {
  let doc = map
  let entities = map.entities
  const created: string[] = []
  const added: string[] = []
  const updated = new Set<string>()
  const removed: string[] = []
  let skipped = 0
  let settings = false

  const updateWhere = (ids: Iterable<string>, fn: (e: MapEntity) => MapEntity, unlocked = true) => {
    const set = new Set(ids)
    let hit = 0
    entities = entities.map((e) => {
      if (!set.has(e.id)) return e
      if (unlocked && e.locked) return e
      hit++
      const next = fn(e)
      if (next !== e) updated.add(e.id)
      return next
    })
    skipped += set.size - hit
  }

  for (const op of ops) {
    switch (op.op) {
      case "add": {
        const made = op.entities.map((n) => newEntityToMap(n, extId, activeLevel))
        entities = op.under ? [...made, ...entities] : [...entities, ...made]
        for (const e of made) {
          created.push(e.id)
          added.push(e.id)
        }
        break
      }
      case "update":
        updateWhere([op.id], (e) => patchToMap(e, op.patch))
        break
      case "remove": {
        const drop = new Set(op.ids)
        const before = entities.length
        entities = entities.filter((e) => {
          const gone = drop.has(e.id) && !e.locked
          if (gone) removed.push(e.id)
          return !gone
        })
        skipped += drop.size - (before - entities.length)
        break
      }
      case "move":
        updateWhere(withAttached(op.ids, entities), (e) => translateEntity(e, op.delta))
        break
      case "transform": {
        const ids = withAttached(op.ids, entities)
        const picked = entities.filter((e) => ids.has(e.id))
        const box = selectionBounds(picked, sizeOf)
        const pivot: Vec2 =
          op.pivot ?? (box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : { x: 0, y: 0 })
        updateWhere(ids, (e) => {
          let next = e
          if (op.rotate || (op.scale && op.scale !== 1))
            next = transformEntity(next, pivot, op.rotate ?? 0, op.scale ?? 1)
          if (op.flipX) next = flipEntity(next, pivot, "x")
          if (op.flipY) next = flipEntity(next, pivot, "y")
          return next
        })
        break
      }
      case "replaceAsset": {
        const ids = op.ids ?? entities.map((e) => e.id)
        updateWhere(
          ids,
          (e) =>
            ASSET_KINDS.has(e.toolId) && e.params.asset === op.from
              ? { ...e, params: { ...e.params, asset: op.to } }
              : e,
          false,
        )
        break
      }
      case "group": {
        const group = newId()
        updateWhere(op.ids, (e) => ({ ...e, group }))
        break
      }
      case "ungroup":
        updateWhere(op.ids, (e) => ({ ...e, group: undefined }))
        break
      case "link": {
        const link = newId()
        updateWhere(op.ids, (e) => ({ ...e, link }))
        break
      }
      case "unlink":
        updateWhere(op.ids, (e) => ({ ...e, link: undefined }))
        break
      case "lock":
        updateWhere(op.ids, (e) => ({ ...e, locked: op.locked || undefined }), false)
        break
      case "reorder":
        entities = reorder(entities, op.ids, op.mode)
        for (const id of op.ids) updated.add(id)
        break
      case "attach": {
        if (op.parent && op.ids.includes(op.parent))
          throw new OpError("an entity can't be its own parent")
        if (op.parent && withAttached(op.ids, entities).has(op.parent))
          throw new OpError("that would attach an entity to its own child")
        updateWhere(op.ids, (e) => ({ ...e, parent: op.parent ?? undefined }))
        break
      }
      case "setData":
        updateWhere([op.id], (e) => ({ ...e, ext: setExt(e.ext, extId, op.data) }), false)
        break
      case "setMapData":
        doc = { ...doc, ext: setExt(doc.ext, extId, op.data) }
        settings = true
        break
      case "setLevelData":
        doc = {
          ...doc,
          levels: doc.levels.map((l) =>
            l.id === op.id ? { ...l, ext: setExt(l.ext, extId, op.data) } : l,
          ),
        }
        settings = true
        break
      case "addLevel": {
        const id = op.id ?? newId("level")
        if (doc.levels.some((l) => l.id === id)) throw new OpError(`level ${id} exists`)
        doc = { ...doc, levels: [...doc.levels, { id, name: op.name }] }
        settings = true
        break
      }
      case "renameLevel":
        doc = {
          ...doc,
          levels: doc.levels.map((l) => (l.id === op.id ? { ...l, name: op.name } : l)),
        }
        settings = true
        break
      case "removeLevel": {
        if (doc.levels.length <= 1 || !doc.levels.some((l) => l.id === op.id)) {
          skipped++
          break
        }
        doc = { ...doc, levels: doc.levels.filter((l) => l.id !== op.id) }
        entities = entities.filter((e) => {
          const gone = e.level === op.id
          if (gone) removed.push(e.id)
          return !gone
        })
        settings = true
        break
      }
      case "moveLevel": {
        const levels = doc.levels.slice()
        const i = levels.findIndex((l) => l.id === op.id)
        const j = i + op.dir
        if (i < 0 || j < 0 || j >= levels.length) {
          skipped++
          break
        }
        ;[levels[i], levels[j]] = [levels[j], levels[i]]
        doc = { ...doc, levels }
        settings = true
        break
      }
      case "setAmbientLight":
        if (!/^#[0-9a-f]{6}$/i.test(op.color)) throw new OpError("ambient light must be #rrggbb")
        doc = { ...doc, environment: { ...doc.environment, ambientLight: op.color } }
        settings = true
        break
      case "setBuildingWear":
        if (!isBuildingWear(op.wear)) throw new OpError(`unknown building wear ${op.wear}`)
        doc = { ...doc, buildingWear: op.wear }
        settings = true
        break
      case "setPostProcess":
        doc = {
          ...doc,
          postProcess: { ...doc.postProcess, ...normalizePostProcessPatch(op.values) },
        }
        settings = true
        break
      case "resize": {
        const w = Math.round(op.width)
        const h = Math.round(op.height)
        if (!(w >= 1 && h >= 1 && w <= 1000 && h <= 1000))
          throw new OpError("map size must be 1–1000")
        doc = { ...doc, width: w, height: h }
        settings = true
        break
      }
      case "setGrid":
        doc = {
          ...doc,
          grid: normalizeGrid({ ...(doc.grid ?? DEFAULT_GRID), ...op.grid } as MapGrid),
        }
        settings = true
        break
      default:
        throw new OpError(`unknown op ${(op as { op: string }).op}`)
    }
  }
  if (entities !== map.entities) doc = { ...doc, entities }
  for (const id of removed) updated.delete(id)
  for (const id of added) updated.delete(id)
  return {
    map: doc,
    created,
    skipped,
    change: { added, updated: [...updated], removed, settings },
  }
}

function normalizeGrid(g: { kind: string; cellDistance: number; unit: string }): MapGrid {
  return {
    kind: typeof g.kind === "string" && g.kind ? g.kind : "square",
    cellDistance: Number.isFinite(g.cellDistance) && g.cellDistance > 0 ? g.cellDistance : 5,
    unit: typeof g.unit === "string" && g.unit ? g.unit.slice(0, 12) : "ft",
  }
}

/** Move `ids` to the front/back of the draw order, or one step forward/backward. */
export function reorder(
  entities: readonly MapEntity[],
  ids: readonly string[],
  mode: "front" | "back" | "forward" | "backward",
): MapEntity[] {
  const set = new Set(ids)
  if (mode === "front" || mode === "back") {
    const picked = entities.filter((e) => set.has(e.id))
    const rest = entities.filter((e) => !set.has(e.id))
    return mode === "front" ? [...rest, ...picked] : [...picked, ...rest]
  }
  const out = entities.slice()
  if (mode === "forward") {
    for (let i = out.length - 2; i >= 0; i--)
      if (set.has(out[i].id) && !set.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]]
  } else {
    for (let i = 1; i < out.length; i++)
      if (set.has(out[i].id) && !set.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]]
  }
  return out
}

export function toSdkLevels(map: MapDocument, extId: string): Level[] {
  return map.levels.map((l) => ({ id: l.id, name: l.name, data: { ...(l.ext?.[extId] ?? {}) } }))
}

/** Which entities changed between two documents (for map.changed events). */
export function diffEntities(
  before: MapDocument | null,
  after: MapDocument | null,
): Omit<MapChange, "history" | "source"> {
  const prev = new Map((before?.entities ?? []).map((e) => [e.id, e]))
  const added: string[] = []
  const updated: string[] = []
  for (const e of after?.entities ?? []) {
    const old = prev.get(e.id)
    if (!old) added.push(e.id)
    else if (old !== e) updated.push(e.id)
    prev.delete(e.id)
  }
  const settings =
    !!before &&
    !!after &&
    (before.levels !== after.levels ||
      before.environment !== after.environment ||
      before.postProcess !== after.postProcess ||
      before.buildingWear !== after.buildingWear ||
      before.grid !== after.grid ||
      before.ext !== after.ext ||
      before.width !== after.width ||
      before.height !== after.height)
  return { added, updated, removed: [...prev.keys()], settings }
}
