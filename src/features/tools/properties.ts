import { DEFAULT_FONT } from "../fonts/catalog"
import { DEFAULT_CUSTOM_COLOR } from "../../lib/colors"
import { type AssetCategory } from "../../lib/categories"
import { normalizeDegrees } from "../map/model/geometry"
import { type MapEntity } from "../map/model/types"
import {
  LIGHT_PRESETS,
  OBJECT_LAYER_VALUES,
  PATH_TRANSITIONS,
  ROOF_TYPES,
  TEXT_BOX_SHAPES,
  WATER_PRESETS,
} from "./definitions"
import { type AssetRecolor, type AssetSelection, type ToolParamSpec } from "./params"

/**
 * Editable properties of a placed entity, shown by the Select tool. Each one
 * reuses a param spec (so the same controls render it) plus how to read the
 * value out of an entity and the patch that writes it back. Entities snapshot
 * their tool's params, so most properties are a `params` key; a few are
 * entity fields (layer, rotation, scale, flips).
 */
export interface EntityProperty {
  spec: ToolParamSpec
  read: (e: MapEntity) => unknown
  write: (e: MapEntity, value: unknown) => Partial<MapEntity>
  /**
   * "level": the property styles the whole painted layer (water, caves,
   * materials' layer are drawn as one composite per level, styled by its
   * latest stroke), so it's written to every entity of the tool on the level.
   */
  scope?: "level"
}

const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback)

/** A property stored in `entity.params[spec.paramKey]`. */
function param(spec: ToolParamSpec): EntityProperty {
  return {
    spec,
    read: (e) => e.params[spec.paramKey] ?? spec.default,
    write: (e, value) => ({ params: { ...e.params, [spec.paramKey]: value } }),
  }
}

const slider = (paramKey: string, labelKey: string, min: number, max: number, step: number) =>
  ({ kind: "slider", paramKey, labelKey, min, max, step, default: min }) as const
const toggle = (paramKey: string, labelKey: string, def = false) =>
  ({ kind: "switch", paramKey, labelKey, default: def }) as const

const layer: EntityProperty = {
  spec: { kind: "layer", paramKey: "layer", allowed: OBJECT_LAYER_VALUES, default: 100 },
  read: (e) => e.layer,
  write: (_, value) => ({ layer: num(value, 100) }),
}
const rotation: EntityProperty = {
  spec: slider("rotation", "tools.rotation", -180, 180, 1),
  read: (e) => Math.round(normalizeDegrees(e.rotation)),
  write: (_, value) => ({ rotation: num(value, 0) }),
}
const scale: EntityProperty = {
  spec: slider("scale", "tools.scale", 0.1, 4, 0.01),
  read: (e) => e.scale ?? 1,
  write: (_, value) => ({ scale: num(value, 1) }),
}
const flip = (axis: "flipX" | "flipY", labelKey: string): EntityProperty => ({
  spec: toggle(axis, labelKey),
  read: (e) => e[axis] === true,
  write: (_, value) => ({ [axis]: value === true || undefined }),
})
const flipX = flip("flipX", "tools.mirrorHorizontal")
const flipY = flip("flipY", "tools.mirrorVertical")
const shadow = param(toggle("shadow", "tools.shadow", true))
const blockLight = param(toggle("blockLight", "tools.blockLight"))

const transition = (paramKey: string, labelKey: string) =>
  param({ kind: "segmented", paramKey, labelKey, options: PATH_TRANSITIONS, default: "none" })

const bevelCorners = param(toggle("bevelCorners", "tools.bevelCorners", true))
const color = (paramKey: string, labelKey: string, def: string, presets?: string[]) =>
  param({ kind: "customColor", paramKey, labelKey, default: def, presets })
const levelWide = (p: EntityProperty): EntityProperty => ({ ...p, scope: "level" })

const NO_SELECTION: AssetSelection = { assets: [], color: "#ffffff" }

/** An asset stored as an {@link AssetSelection} in `params[paramKey]` (walls, floors, styles…). */
const assetSelection = (
  paramKey: string,
  labelKey: string,
  category: AssetCategory,
  recolor: AssetRecolor = "own",
) =>
  param({
    kind: "assetPicker",
    paramKey,
    labelKey,
    category,
    select: "single",
    allowNull: false,
    recolor,
    default: NO_SELECTION,
  })

/** An asset stored as a plain id in `params.asset` (objects, portals, paths), picked from a browser. */
const assetId = (labelKey: string, category: AssetCategory): EntityProperty => ({
  spec: {
    kind: "assetPicker",
    paramKey: "asset",
    labelKey,
    category,
    select: "single",
    allowNull: false,
    recolor: "none",
    default: NO_SELECTION,
  },
  read: (e) => ({
    assets: typeof e.params.asset === "string" && e.params.asset ? [e.params.asset] : [],
    color: "#ffffff",
  }),
  write: (e, value) => {
    const picked = (value as AssetSelection | null)?.assets[0]
    return picked ? { params: { ...e.params, asset: picked } } : {}
  },
})

/** An object's tint (colorable assets), stored as `params.color` ("" = untinted). */
const objectColor: EntityProperty = {
  spec: {
    kind: "customColor",
    paramKey: "color",
    labelKey: "tools.customColor",
    default: DEFAULT_CUSTOM_COLOR,
  },
  read: (e) => (typeof e.params.color === "string" && e.params.color) || DEFAULT_CUSTOM_COLOR,
  write: (e, value) => ({ params: { ...e.params, color: value } }),
}

/**
 * Properties per tool id, in display order (asset browsers last: they fill
 * the rest of the panel). Tools not listed show none.
 */
export const ENTITY_PROPERTIES: Record<string, EntityProperty[]> = {
  object: [
    layer,
    rotation,
    scale,
    flipX,
    flipY,
    shadow,
    blockLight,
    objectColor,
    assetId("tools.assetProperty", "objects"),
  ],
  scatter: [
    layer,
    rotation,
    scale,
    flipX,
    flipY,
    shadow,
    objectColor,
    assetId("tools.assetProperty", "objects"),
  ],
  portal: [rotation, scale, flipX, flipY, blockLight, shadow, assetId("tools.style", "portals")],
  wall: [bevelCorners, shadow, assetSelection("wall", "tools.buildWall", "walls")],
  build: [bevelCorners, shadow, assetSelection("floor", "tools.floor", "tilesets")],
  pattern: [
    layer,
    param(slider("rotation", "tools.rotation", -180, 180, 1)),
    param(toggle("outline", "tools.outline")),
    shadow,
    color("customColor", "tools.color", DEFAULT_CUSTOM_COLOR),
    assetSelection("pattern", "tools.patternAsset", "tilesets", "none"),
  ],
  roof: [
    param({
      kind: "segmented",
      paramKey: "type",
      labelKey: "tools.type",
      options: ROOF_TYPES,
      default: "gable",
    }),
    param(slider("width", "tools.roofWidth", 0.25, 16, 0.25)),
    param(toggle("shade", "tools.shade", true)),
    param(slider("sunDirection", "tools.sunDirection", -180, 180, 0.1)),
    param(slider("shadeContrast", "tools.shadeContrast", 0, 1, 0.05)),
    shadow,
    assetSelection("style", "tools.style", "roofs", "none"),
  ],
  light: [
    param(slider("range", "tools.range", 0.5, 20, 0.1)),
    param(slider("intensity", "tools.intensity", 0.5, 3, 0.1)),
    rotation,
    shadow,
    color("color", "tools.color", "#eccd8b", LIGHT_PRESETS),
    assetSelection("style", "tools.style", "lights"),
  ],
  path: [
    layer,
    param(slider("width", "tools.width", 0.1, 5, 0.01)),
    param(slider("smoothness", "tools.smoothness", 0, 1, 0.1)),
    blockLight,
    shadow,
    transition("transitionIn", "tools.transitionIn"),
    transition("transitionOut", "tools.transitionOut"),
    assetId("tools.assetProperty", "paths"),
  ],
  water: [
    levelWide(color("deepColor", "tools.deepColor", "#3aa19a", WATER_PRESETS)),
    levelWide(color("shallowColor", "tools.shallowColor", "#8bceb0", WATER_PRESETS)),
    levelWide(param(slider("blendDistance", "tools.blendDistance", 0.5, 4, 0.1))),
    levelWide(param(toggle("disableBorder", "tools.disableBorder"))),
  ],
  cave: [
    levelWide(color("groundColor", "tools.groundColor", DEFAULT_CUSTOM_COLOR)),
    levelWide(color("wallColor", "tools.wallColor", DEFAULT_CUSTOM_COLOR)),
    levelWide(assetSelection("style", "tools.style", "caves", "none")),
  ],
  material: [levelWide(layer), assetSelection("material", "tools.materialAsset", "tilesets")],
  text: [
    param({ kind: "font", paramKey: "font", labelKey: "tools.font", default: DEFAULT_FONT }),
    param(slider("fontSize", "tools.fontSize", 8, 256, 1)),
    color("fontColor", "tools.fontColor", "#000000"),
    param({
      kind: "segmented",
      paramKey: "boxShape",
      labelKey: "tools.boxShape",
      options: TEXT_BOX_SHAPES,
      default: "none",
    }),
    param(slider("boxBorderWidth", "tools.boxBorderWidth", 0, 32, 1)),
    color("boxColor", "tools.boxColor", "#ffffff"),
    color("boxBorderColor", "tools.boxBorderColor", "#000000"),
  ],
}

/**
 * The properties every entity in `entities` has (by key, in the first one's
 * order): what the Select tool can show for a multi-selection.
 */
export function sharedProperties(entities: readonly MapEntity[]): EntityProperty[] {
  if (entities.length === 0) return []
  const lists = entities.map((e) => ENTITY_PROPERTIES[e.toolId] ?? [])
  // An asset browser shows one tool's category: only for a single kind of element.
  const oneTool = entities.every((e) => e.toolId === entities[0].toolId)
  return lists[0].filter(
    (p) =>
      (oneTool || p.spec.kind !== "assetPicker") &&
      lists.every((l) => l.some((q) => q.spec.paramKey === p.spec.paramKey)),
  )
}

/**
 * Patches setting property `key` to `value` on every entity (each through
 * its own tool's property). Level-wide properties also reach the other
 * entities of the tool on the same level, among `all`.
 */
export function propertyPatches(
  entities: readonly MapEntity[],
  key: string,
  value: unknown,
  all: readonly MapEntity[] = entities,
): Map<string, Partial<MapEntity>> {
  const patches = new Map<string, Partial<MapEntity>>()
  const propOf = (e: MapEntity) => ENTITY_PROPERTIES[e.toolId]?.find((p) => p.spec.paramKey === key)
  for (const e of entities) {
    const prop = propOf(e)
    if (!prop) continue
    const targets =
      prop.scope === "level" ? all.filter((x) => x.toolId === e.toolId && x.level === e.level) : [e]
    for (const t of targets) if (!patches.has(t.id)) patches.set(t.id, prop.write(t, value))
  }
  return patches
}
