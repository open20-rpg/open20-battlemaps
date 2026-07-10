import type { IconType } from "react-icons"
import {
  LuBox,
  LuBoxes,
  LuBrickWall,
  LuBrush,
  LuCloudSun,
  LuDoorOpen,
  LuDraftingCompass,
  LuDroplets,
  LuGrid3X3,
  LuHouse,
  LuImage,
  LuLayers,
  LuLightbulb,
  LuMap,
  LuMountain,
  LuMountainSnow,
  LuMousePointer2,
  LuPaintBucket,
  LuRoute,
  LuSettings2,
  LuShapes,
  LuSparkles,
  LuSprayCan,
  LuTriangle,
  LuType,
} from "react-icons/lu"

/**
 * Map layers (Godot z-order buckets). The `value` is fixed and stored in tool
 * params / the map; the `nameKey` is translatable because the names are fixed.
 * Ordered from bottom-most to top-most.
 */
export interface MapLayer {
  value: number
  nameKey: string
}

export const MAP_LAYERS: MapLayer[] = [
  { value: -500, nameKey: "layers.terrain" },
  { value: -400, nameKey: "layers.belowGround" },
  { value: -300, nameKey: "layers.caves" },
  { value: -200, nameKey: "layers.floor" },
  { value: -100, nameKey: "layers.belowWater" },
  { value: 0, nameKey: "layers.water" },
  { value: 100, nameKey: "layers.userLayer1" },
  { value: 200, nameKey: "layers.userLayer2" },
  { value: 300, nameKey: "layers.userLayer3" },
  { value: 400, nameKey: "layers.userLayer4" },
  { value: 500, nameKey: "layers.portals" },
  { value: 600, nameKey: "layers.walls" },
  { value: 700, nameKey: "layers.aboveWalls" },
  { value: 800, nameKey: "layers.roofs" },
  { value: 900, nameKey: "layers.aboveRoofs" },
]

/**
 * Layers selectable by object-like tools (Object, Scatter, Material, Path).
 * They share the same allowed set; only the default layer differs per tool.
 */
export const OBJECT_LAYER_VALUES = [-400, -100, 100, 200, 300, 400, 700, 900]

/**
 * A reusable tool parameter. Controls are shared across tools (a color, a layer
 * selector, …); a tool just declares which params it exposes and their config.
 */
/** Within a layer, whether the tool places new items on top or at the bottom. */
export type Sorting = "over" | "under"

/** The geometry a shape/area tool draws with. */
export type Shape = "rectangle" | "ellipse" | "path"

export type ToolParamSpec =
  | { kind: "customColor" }
  | { kind: "layer"; allowed: number[]; default: number }
  | { kind: "sorting"; default: Sorting }
  | { kind: "shadow"; default: boolean }
  | { kind: "shape"; default: Shape | null }
  | {
      kind: "brushSize"
      /** "slider" = draggable slider; "buttons" = one growing-circle button per step. */
      ui: "slider" | "buttons"
      min: number
      max: number
      step: number
      default: number | null
    }
  | { kind: "editPoints"; default: boolean }
  | { kind: "bevelCorners"; default: boolean }
  | {
      kind: "assetPicker"
      /** Where the { assets, color } value is stored in the tool's params. */
      paramKey: string
      /** i18n label shown above the browser. */
      labelKey: string
      /** Asset category to browse (e.g. "floors", "walls"). */
      category: string
      select: "single" | "multi"
      defaultColor: string
    }

/** A per-tool parameter bag; shape is defined by each tool's params. */
export type ToolParamValues = Record<string, unknown>

/**
 * Cross-field rule run right after a param change: given the already-merged
 * params and the patch that caused the change, it returns the params to store.
 * Use it to keep dependent params consistent (e.g. mutually-exclusive fields)
 * instead of reacting after the fact with an effect.
 */
export type ParamNormalizer = (
  merged: ToolParamValues,
  patch: ToolParamValues,
) => ToolParamValues

/**
 * When one of two params is set to a non-null value, clear the other. Reusable
 * building block for mutually-exclusive params (e.g. Water Brush's shape vs
 * brush size — picking one unsets the other).
 */
export const mutuallyExclusiveNull = (a: string, b: string): ParamNormalizer => (merged, patch) => {
  if (a in patch && merged[a] != null) return { ...merged, [b]: null }
  if (b in patch && merged[b] != null) return { ...merged, [a]: null }
  return merged
}

/**
 * Exclusivity between `shape` and `editPoints`: exactly one is active. Turning
 * edit-points on clears the shape; picking a shape turns edit-points off;
 * turning edit-points off requires a shape, so it restores `defaultShape` when
 * none is selected.
 */
export const shapeVsEditPoints = (defaultShape: Shape): ParamNormalizer => (merged, patch) => {
  if (patch.editPoints === true) return { ...merged, shape: null }
  if ("shape" in patch && patch.shape != null) return { ...merged, editPoints: false }
  if (patch.editPoints === false && merged.shape == null)
    return { ...merged, shape: defaultShape }
  return merged
}

/** A tool that opens a parameters panel (its declared params) when selected. */
export interface ToolLeaf {
  type: "tool"
  id: string
  /** i18n key for the display name. */
  nameKey: string
  icon: IconType
  /** If set, the Library panel opens on the right, filtered to this category. */
  library?: string
  /** Parameter controls shown in this tool's panel, in order. */
  params?: ToolParamSpec[]
  /** Cross-field rule applied after any of this tool's params changes. */
  normalizeParams?: ParamNormalizer
}

/** A folder that opens a panel listing its children. */
export interface ToolGroup {
  type: "group"
  id: string
  nameKey: string
  icon: IconType
  children: ToolNode[]
}

export type ToolNode = ToolLeaf | ToolGroup

const tool = (
  id: string,
  nameKey: string,
  icon: IconType,
  opts?: { library?: string; params?: ToolParamSpec[]; normalizeParams?: ParamNormalizer },
): ToolLeaf => ({
  type: "tool",
  id,
  nameKey,
  icon,
  library: opts?.library,
  params: opts?.params,
  normalizeParams: opts?.normalizeParams,
})

// Shared param specs, so tools reuse the same controls with minimal config.
const customColor: ToolParamSpec = { kind: "customColor" }
const objectLayer = (def: number): ToolParamSpec => ({
  kind: "layer",
  allowed: OBJECT_LAYER_VALUES,
  default: def,
})
const sorting = (def: Sorting): ToolParamSpec => ({ kind: "sorting", default: def })
const shadow = (def: boolean): ToolParamSpec => ({ kind: "shadow", default: def })
const shape = (def: Shape | null): ToolParamSpec => ({ kind: "shape", default: def })
const editPoints = (def: boolean): ToolParamSpec => ({ kind: "editPoints", default: def })
const bevelCorners = (def: boolean): ToolParamSpec => ({ kind: "bevelCorners", default: def })
const assetPicker = (
  paramKey: string,
  labelKey: string,
  category: string,
  select: "single" | "multi",
  defaultColor: string,
): ToolParamSpec => ({ kind: "assetPicker", paramKey, labelKey, category, select, defaultColor })

/**
 * Whether a param control should flex-grow to fill leftover panel height (vs.
 * taking its natural height). Asset pickers grow (and split the space evenly
 * when several are present); everything else stays compact.
 */
export function paramGrows(spec: ToolParamSpec): boolean {
  return spec.kind === "assetPicker"
}
const brushSlider = (
  min: number,
  max: number,
  step: number,
  def: number | null,
): ToolParamSpec => ({ kind: "brushSize", ui: "slider", min, max, step, default: def })
const brushButtons = (
  min: number,
  max: number,
  step: number,
  def: number | null,
): ToolParamSpec => ({ kind: "brushSize", ui: "buttons", min, max, step, default: def })

/** The top-level tool palette. Groups expand into their own panels. */
export const TOOL_TREE: ToolNode[] = [
  {
    type: "group",
    id: "design",
    nameKey: "tools.design",
    icon: LuDraftingCompass,
    children: [
      tool("build", "tools.build", LuHouse, {
        params: [
          shape("rectangle"),
          editPoints(false),
          assetPicker("floor", "tools.floor", "tilesets", "single", "#ffffff"),
          assetPicker("wall", "tools.buildWall", "walls", "single", "#ffffff"),
          bevelCorners(true),
        ],
        normalizeParams: shapeVsEditPoints("rectangle"),
      }),
      tool("wall", "tools.wall", LuBrickWall, {
        params: [
          editPoints(false),
          sorting("under"),
          shadow(true),
          assetPicker("wall", "tools.buildWall", "walls", "single", "#ffffff"),
          bevelCorners(true),
        ],
      }),
      tool("portal", "tools.portal", LuDoorOpen, { library: "portals", params: [customColor] }),
      tool("cave", "tools.cave", LuMountainSnow, {
        library: "caves",
        params: [customColor, brushButtons(0.5, 2.5, 0.5, 1)],
      }),
      tool("pattern", "tools.pattern", LuGrid3X3, {
        library: "tilesets",
        params: [customColor, shape("rectangle"), editPoints(false)],
        normalizeParams: shapeVsEditPoints("rectangle"),
      }),
      tool("roof", "tools.roof", LuTriangle, {
        library: "roofs",
        params: [customColor, sorting("over")],
      }),
    ],
  },
  {
    type: "group",
    id: "terrain",
    nameKey: "tools.terrain",
    icon: LuMountain,
    children: [
      tool("terrainBrush", "tools.terrainBrush", LuBrush, {
        params: [brushSlider(1, 25, 1, 8)],
      }),
      tool("water", "tools.water", LuDroplets, {
        params: [shape("rectangle"), brushButtons(0.5, 2.5, 0.5, null)],
        // Shape and brush size are mutually exclusive: picking one clears the other.
        normalizeParams: mutuallyExclusiveNull("brushSize", "shape"),
      }),
      tool("material", "tools.material", LuPaintBucket, {
        params: [objectLayer(-400), brushButtons(1, 5, 1, 2)],
      }),
      tool("path", "tools.path", LuRoute, {
        library: "paths",
        params: [customColor, objectLayer(100), sorting("over"), shadow(false), editPoints(false)],
      }),
    ],
  },
  {
    type: "group",
    id: "objects",
    nameKey: "tools.objects",
    icon: LuShapes,
    children: [
      tool("object", "tools.object", LuBox, {
        library: "objects",
        params: [customColor, objectLayer(100), sorting("over"), shadow(true)],
      }),
      tool("scatter", "tools.scatter", LuSprayCan, {
        library: "objects",
        params: [customColor, objectLayer(100), sorting("over"), shadow(true)],
      }),
    ],
  },
  {
    type: "group",
    id: "effects",
    nameKey: "tools.effects",
    icon: LuSparkles,
    children: [
      tool("environment", "tools.environment", LuCloudSun),
      tool("light", "tools.light", LuLightbulb, { params: [shadow(true)] }),
    ],
  },
  {
    type: "group",
    id: "settings",
    nameKey: "tools.settings",
    icon: LuSettings2,
    children: [
      tool("mapSettings", "tools.mapSettings", LuMap),
      tool("levelSettings", "tools.levelSettings", LuLayers),
      tool("referenceImage", "tools.referenceImage", LuImage),
    ],
  },
  tool("text", "tools.text", LuType),
  tool("prefabs", "tools.prefabs", LuBoxes),
  tool("select", "tools.select", LuMousePointer2),
]

/** Find the chain of nodes leading to (and including) the node with `id`. */
export function findToolPath(
  nodes: ToolNode[],
  id: string,
  trail: ToolNode[] = [],
): ToolNode[] | null {
  for (const node of nodes) {
    const next = [...trail, node]
    if (node.id === id) return next
    if (node.type === "group") {
      const found = findToolPath(node.children, id, next)
      if (found) return found
    }
  }
  return null
}
