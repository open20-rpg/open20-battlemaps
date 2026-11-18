import { type AssetCategory } from "../../lib/categories"
import { TOOL_BY_ID } from "../tools/definitions"
import { type AssetSelection } from "../tools/params"
import { type TerrainData } from "./model/terrain"
import { type MapEntity } from "./model/types"

/**
 * Assets an open map references but that can't be drawn: their pack isn't
 * installed, the file isn't in it, or they're Dungeondraft's own built-in
 * art / an image embedded in a `.dungeondraft_map` (never available here).
 * The Replace Assets tool lists them and swaps them for installed ones.
 */

/** Why an asset can't be found. */
export type MissingSource = "builtin" | "embedded" | "pack"

export interface MissingAsset {
  /** The asset id as stored in the entities ("{packId}|{relPath}"). */
  id: string
  /** Readable name taken from the file (or its folder, for grouped textures). */
  name: string
  source: MissingSource
  /** Pack id for `source: "pack"`. */
  packId?: string
  /** Library category to pick a replacement from (null when it can't be told). */
  category: AssetCategory | null
  /** Entities using it, in document order. */
  entityIds: string[]
  /** Level ids those entities are on (no duplicates, document order). */
  levels: string[]
}

/** Ids imported from Dungeondraft's own library or embedded images (dungeondraft.ts). */
const DUNGEONDRAFT_PREFIX = "dungeondraft|"

/** Whether a string param holds an asset id rather than any text (a label can contain "|"). */
const ASSET_ID = /^[^|\s]+\|(textures\/|embedded:\/\/)/

export function isAssetId(value: unknown): value is string {
  return typeof value === "string" && ASSET_ID.test(value)
}

const isSelection = (v: unknown): v is AssetSelection =>
  !!v && typeof v === "object" && Array.isArray((v as AssetSelection).assets)

const isTerrain = (v: unknown): v is TerrainData =>
  !!v && typeof v === "object" && Array.isArray((v as TerrainData).slots)

/** Every asset id an entity references, with the param it sits in. */
export function assetRefsOf(entity: MapEntity): { paramKey: string; id: string }[] {
  const out: { paramKey: string; id: string }[] = []
  // A label's text is free-form: it may well look like an id.
  if (entity.toolId === "text") return out
  for (const [paramKey, value] of Object.entries(entity.params)) {
    if (isAssetId(value)) out.push({ paramKey, id: value })
    else if (isSelection(value)) {
      for (const id of value.assets) if (isAssetId(id)) out.push({ paramKey, id })
    } else if (isTerrain(value)) {
      for (const id of value.slots) if (isAssetId(id)) out.push({ paramKey, id })
    }
  }
  return out
}

/** Distinct asset ids referenced by `entities`. */
export function collectAssetIds(entities: readonly MapEntity[]): string[] {
  const ids = new Set<string>()
  for (const e of entities) for (const ref of assetRefsOf(e)) ids.add(ref.id)
  return [...ids]
}

const CATEGORY_FOLDERS = new Set<string>([
  "tilesets",
  "walls",
  "portals",
  "caves",
  "roofs",
  "paths",
  "objects",
  "terrain",
  "lights",
  "materials",
])

/**
 * The Library category a replacement must come from: the one of the tool
 * param the asset sits in (entity params and tool params share keys for
 * pickers), else the tool's Library or its only picker (a portal's `asset`
 * is its Style), else the texture's folder.
 */
export function categoryOf(entity: MapEntity, paramKey: string, id: string): AssetCategory | null {
  if (isTerrain(entity.params[paramKey])) return "terrain"
  const tool = TOOL_BY_ID.get(entity.toolId)
  const pickers = (tool?.params ?? []).flatMap((p) => (p.kind === "assetPicker" ? [p] : []))
  const own = pickers.find((p) => p.paramKey === paramKey)
  if (own) return own.category
  if (tool?.library) return tool.library
  if (pickers.length === 1) return pickers[0].category
  const folder = /\|textures\/([^/]+)\//.exec(id)?.[1]
  return folder && CATEGORY_FOLDERS.has(folder) ? (folder as AssetCategory) : null
}

/** File names grouped textures use for their parts: the folder names the asset. */
const PART_NAMES = new Set(["floor", "wall", "tiles", "tile", "edge", "ridge", "texture"])

/** Where an asset id comes from and a readable name for it. */
export function describeAssetId(id: string): Pick<MissingAsset, "name" | "source" | "packId"> {
  const bar = id.indexOf("|")
  const packId = id.slice(0, bar)
  const rel = id.slice(bar + 1)
  const parts = rel.replace(/^embedded:\/\//, "").split("/")
  const stem = (parts.at(-1) ?? rel).replace(/\.[^.]+$/, "")
  const base =
    PART_NAMES.has(stem.toLowerCase()) && parts.length > 1 ? (parts.at(-2) ?? stem) : stem
  const name = base.replace(/[_-]+/g, " ").trim() || rel
  if (packId === DUNGEONDRAFT_PREFIX.slice(0, -1)) {
    return { name, source: rel.startsWith("embedded://") ? "embedded" : "builtin" }
  }
  return { name, source: "pack", packId }
}

/**
 * What to search the Library for to find a stand-in: the name's first real
 * word ("barrel 01" → "barrel", "table round wood" → "table"), which is
 * what the thing is; the rest tends to be variants, materials and numbers.
 */
export function suggestQuery(name: string): string {
  return name.split(/\s+/).find((w) => w.length >= 3 && !/\d/.test(w)) ?? ""
}

/**
 * Group the entities' unavailable assets (per `isMissing`) by asset id,
 * most used first, then by name.
 */
export function findMissingAssets(
  entities: readonly MapEntity[],
  isMissing: (id: string) => boolean,
): MissingAsset[] {
  const byId = new Map<string, MissingAsset>()
  for (const e of entities) {
    for (const { paramKey, id } of assetRefsOf(e)) {
      if (!isMissing(id)) continue
      let item = byId.get(id)
      if (!item) {
        item = {
          id,
          ...describeAssetId(id),
          category: categoryOf(e, paramKey, id),
          entityIds: [],
          levels: [],
        }
        byId.set(id, item)
      }
      if (item.entityIds.at(-1) !== e.id) item.entityIds.push(e.id)
      if (e.level && !item.levels.includes(e.level)) item.levels.push(e.level)
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.entityIds.length - a.entityIds.length || a.name.localeCompare(b.name),
  )
}

/**
 * `entity` with every reference to asset `from` pointing at `to` instead
 * (the same object when it doesn't use `from`). A selection that already
 * holds `to` just drops `from`, so a multi-pick never lists an asset twice.
 */
export function replaceAssetIn(entity: MapEntity, from: string, to: string): MapEntity {
  let params: MapEntity["params"] | null = null
  for (const [key, value] of Object.entries(entity.params)) {
    let next: unknown = value
    if (value === from) next = to
    else if (isSelection(value) && value.assets.includes(from)) {
      const assets = value.assets.map((id) => (id === from ? to : id))
      next = { ...value, assets: assets.filter((id, i) => assets.indexOf(id) === i) }
    } else if (isTerrain(value) && value.slots.includes(from)) {
      next = { ...value, slots: value.slots.map((id) => (id === from ? to : id)) }
    }
    if (next !== value) {
      params ??= { ...entity.params }
      params[key] = next
    }
  }
  return params ? { ...entity, params } : entity
}
