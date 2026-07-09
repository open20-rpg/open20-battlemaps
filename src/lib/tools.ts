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

/** A tool that opens a (currently empty) parameters panel when selected. */
export interface ToolLeaf {
  type: "tool"
  id: string
  /** i18n key for the display name. */
  nameKey: string
  icon: IconType
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

const tool = (id: string, nameKey: string, icon: IconType): ToolLeaf => ({
  type: "tool",
  id,
  nameKey,
  icon,
})

/** The top-level tool palette. Groups expand into their own panels. */
export const TOOL_TREE: ToolNode[] = [
  {
    type: "group",
    id: "design",
    nameKey: "tools.design",
    icon: LuDraftingCompass,
    children: [
      tool("build", "tools.build", LuHouse),
      tool("wall", "tools.wall", LuBrickWall),
      tool("portal", "tools.portal", LuDoorOpen),
      tool("cave", "tools.cave", LuMountainSnow),
      tool("pattern", "tools.pattern", LuGrid3X3),
      tool("roof", "tools.roof", LuTriangle),
    ],
  },
  {
    type: "group",
    id: "terrain",
    nameKey: "tools.terrain",
    icon: LuMountain,
    children: [
      tool("terrainBrush", "tools.terrainBrush", LuBrush),
      tool("water", "tools.water", LuDroplets),
      tool("material", "tools.material", LuPaintBucket),
      tool("path", "tools.path", LuRoute),
    ],
  },
  {
    type: "group",
    id: "objects",
    nameKey: "tools.objects",
    icon: LuShapes,
    children: [
      tool("object", "tools.object", LuBox),
      tool("scatter", "tools.scatter", LuSprayCan),
    ],
  },
  {
    type: "group",
    id: "effects",
    nameKey: "tools.effects",
    icon: LuSparkles,
    children: [
      tool("environment", "tools.environment", LuCloudSun),
      tool("light", "tools.light", LuLightbulb),
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
