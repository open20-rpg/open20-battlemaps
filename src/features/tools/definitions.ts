import { type IconType } from "react-icons"
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
import { type AssetCategory } from "../../lib/categories"
import { DEFAULT_CUSTOM_COLOR } from "../../lib/colors"
import {
  shapeVsEditPoints,
  type ParamNormalizer,
  type Shape,
  type Sorting,
  type ToolParamSpec,
  type ToolParamValues,
} from "./params"

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

/** A tool that opens a parameters panel (its declared params) when selected. */
export interface ToolLeaf {
  type: "tool"
  id: string
  /** i18n key for the display name. */
  nameKey: string
  icon: IconType
  /** If set, the Library panel opens on the right, filtered to this category. */
  library?: AssetCategory
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
  opts?: {
    library?: AssetCategory
    params?: ToolParamSpec[]
    normalizeParams?: ParamNormalizer
  },
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
// Every spec carries an explicit paramKey; defaults live only in the spec.
const customColor: ToolParamSpec = {
  kind: "customColor",
  paramKey: "customColor",
  default: DEFAULT_CUSTOM_COLOR,
}
const objectLayer = (def: number): ToolParamSpec => ({
  kind: "layer",
  paramKey: "layer",
  allowed: OBJECT_LAYER_VALUES,
  default: def,
})
const sorting = (def: Sorting): ToolParamSpec => ({
  kind: "sorting",
  paramKey: "sorting",
  default: def,
})
const switchParam = (paramKey: string, labelKey: string, def: boolean): ToolParamSpec => ({
  kind: "switch",
  paramKey,
  labelKey,
  default: def,
})
const shadow = (def: boolean): ToolParamSpec => switchParam("shadow", "tools.shadow", def)
const bevelCorners = (def: boolean): ToolParamSpec =>
  switchParam("bevelCorners", "tools.bevelCorners", def)
const sliderParam = (
  paramKey: string,
  labelKey: string,
  min: number,
  max: number,
  step: number,
  def: number,
): ToolParamSpec => ({ kind: "slider", paramKey, labelKey, min, max, step, default: def })
const shape = (def: Shape | null, allowBrush = false): ToolParamSpec => ({
  kind: "shape",
  paramKey: "shape",
  default: def,
  allowBrush,
})
const editPoints = (def: boolean): ToolParamSpec => ({
  kind: "editPoints",
  paramKey: "editPoints",
  default: def,
})
const brushSize = (min: number, max: number, step: number, def: number): ToolParamSpec => ({
  kind: "brushSize",
  paramKey: "brushSize",
  min,
  max,
  step,
  default: def,
})
const assetPicker = (
  paramKey: string,
  labelKey: string,
  category: AssetCategory,
  select: "single" | "multi",
  defaultColor: string,
  allowNull = false,
): ToolParamSpec => ({
  kind: "assetPicker",
  paramKey,
  labelKey,
  category,
  select,
  default: { assets: [], color: defaultColor },
  allowNull,
})

/** Gate a param's visibility on the tool's current params. */
const when = (
  spec: ToolParamSpec,
  visibleWhen: (values: ToolParamValues) => boolean,
): ToolParamSpec => ({ ...spec, visibleWhen })

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
          bevelCorners(true),
          assetPicker("floor", "tools.floor", "tilesets", "single", "#ffffff"),
          assetPicker("wall", "tools.buildWall", "walls", "single", "#ffffff"),
        ],
        normalizeParams: shapeVsEditPoints("rectangle"),
      }),
      tool("wall", "tools.wall", LuBrickWall, {
        params: [
          editPoints(false),
          sorting("under"),
          bevelCorners(true),
          shadow(true),
          assetPicker("wall", "tools.buildWall", "walls", "single", "#ffffff"),
        ],
      }),
      tool("portal", "tools.portal", LuDoorOpen, {
        params: [
          switchParam("blockLight", "tools.blockLight", false),
          switchParam("anchored", "tools.anchored", true),
          // Anchored portals snap in 180° flips; freestanding ones rotate freely.
          when(switchParam("rotate180", "tools.rotate180", false), (p) => p.anchored !== false),
          when(
            sliderParam("rotation", "tools.rotation", -180, 180, 1, 0),
            (p) => p.anchored === false,
          ),
          assetPicker("style", "tools.style", "portals", "single", "#ffffff", true),
        ],
      }),
      tool("cave", "tools.cave", LuMountainSnow, {
        library: "caves",
        params: [customColor, brushSize(0.5, 2.5, 0.5, 1)],
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
        params: [brushSize(1, 25, 1, 8)],
      }),
      tool("water", "tools.water", LuDroplets, {
        // Free-paint via the `brush` shape; the size slider is always visible.
        params: [shape("brush", true), brushSize(0.5, 2.5, 0.5, 1)],
      }),
      tool("material", "tools.material", LuPaintBucket, {
        params: [objectLayer(-400), brushSize(1, 5, 1, 2)],
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

const collectLeaves = (nodes: ToolNode[], into: Map<string, ToolLeaf>): Map<string, ToolLeaf> => {
  for (const node of nodes) {
    if (node.type === "tool") into.set(node.id, node)
    else collectLeaves(node.children, into)
  }
  return into
}

/** Flat id → leaf index, built once (param updates hit this on every change). */
export const TOOL_BY_ID: ReadonlyMap<string, ToolLeaf> = collectLeaves(TOOL_TREE, new Map())
