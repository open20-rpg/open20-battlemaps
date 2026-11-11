import { normalizeDegrees } from "../map/model/geometry"
import { type MapEntity } from "../map/model/types"
import { LIGHT_PRESETS, OBJECT_LAYER_VALUES, PATH_TRANSITIONS } from "./definitions"
import { type ToolParamSpec } from "./params"

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

/** Properties per tool id, in display order. Tools not listed show none. */
export const ENTITY_PROPERTIES: Record<string, EntityProperty[]> = {
  object: [layer, rotation, scale, flipX, flipY, shadow, blockLight],
  scatter: [layer, rotation, scale, flipX, flipY, shadow],
  portal: [rotation, scale, flipX, flipY, blockLight],
  light: [
    param(slider("range", "tools.range", 0.5, 20, 0.1)),
    param(slider("intensity", "tools.intensity", 0.5, 3, 0.1)),
    rotation,
    shadow,
    param({
      kind: "customColor",
      paramKey: "color",
      labelKey: "tools.color",
      default: "#eccd8b",
      presets: LIGHT_PRESETS,
    }),
  ],
  path: [
    layer,
    param(slider("width", "tools.width", 0.1, 5, 0.01)),
    param(slider("smoothness", "tools.smoothness", 0, 1, 0.1)),
    blockLight,
    transition("transitionIn", "tools.transitionIn"),
    transition("transitionOut", "tools.transitionOut"),
  ],
  text: [
    param({ kind: "font", paramKey: "font", labelKey: "tools.font", default: "" }),
    param(slider("fontSize", "tools.fontSize", 8, 256, 1)),
    param({
      kind: "customColor",
      paramKey: "fontColor",
      labelKey: "tools.fontColor",
      default: "#000000",
    }),
    param(toggle("textBox", "tools.textBox")),
  ],
}

/**
 * The properties every entity in `entities` has (by key, in the first one's
 * order): what the Select tool can show for a multi-selection.
 */
export function sharedProperties(entities: readonly MapEntity[]): EntityProperty[] {
  if (entities.length === 0) return []
  const lists = entities.map((e) => ENTITY_PROPERTIES[e.toolId] ?? [])
  return lists[0].filter((p) =>
    lists.every((l) => l.some((q) => q.spec.paramKey === p.spec.paramKey)),
  )
}

/** Patches setting property `key` to `value` on every entity (each through its own tool's property). */
export function propertyPatches(
  entities: readonly MapEntity[],
  key: string,
  value: unknown,
): Map<string, Partial<MapEntity>> {
  const patches = new Map<string, Partial<MapEntity>>()
  for (const e of entities) {
    const prop = ENTITY_PROPERTIES[e.toolId]?.find((p) => p.spec.paramKey === key)
    if (prop) patches.set(e.id, prop.write(e, value))
  }
  return patches
}
