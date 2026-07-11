import { create } from "zustand"
import {
  TOOL_BY_ID,
  TOOL_TREE,
  findToolPath,
  type ToolLeaf,
  type ToolNode,
} from "../features/tools/definitions"
import { resolveParams, type ToolParamValues } from "../features/tools/params"

interface ToolsState {
  /** The selection chain, from the top-level pick inward. Drives the panels. */
  path: ToolNode[]
  /**
   * Per-tool parameter bags. A tool's bag is materialized from its spec
   * defaults the first time it is selected, so state always holds complete
   * values (never rely on controls to fill gaps at read time).
   */
  paramsByTool: Record<string, ToolParamValues>
  /** Select a top-level node (toggles off if it is already the current top). */
  selectTop: (node: ToolNode) => void
  /** Select a child of the group at `depth`, replacing anything deeper. */
  selectChild: (depth: number, child: ToolNode) => void
  /** Select any tool by id (e.g. from a keyboard shortcut or a feature). */
  selectToolById: (id: string) => void
  /** Clear the current selection. */
  reset: () => void
  /** Merge a patch into a tool's parameters (normalizer applied in the same update). */
  setToolParams: (toolId: string, patch: ToolParamValues) => void
}

/** Materialize default params for any leaves in `path` that lack a bag. */
function withMaterialized(
  paramsByTool: Record<string, ToolParamValues>,
  path: ToolNode[],
): Record<string, ToolParamValues> {
  let next = paramsByTool
  for (const node of path) {
    if (node.type === "tool" && !next[node.id]) {
      if (next === paramsByTool) next = { ...paramsByTool }
      next[node.id] = resolveParams(node.params)
    }
  }
  return next
}

export const useToolsStore = create<ToolsState>()((set) => ({
  path: [],
  paramsByTool: {},

  selectTop: (node) =>
    set((s) => {
      const path = s.path[0]?.id === node.id ? [] : [node]
      return { path, paramsByTool: withMaterialized(s.paramsByTool, path) }
    }),

  selectChild: (depth, child) =>
    set((s) => {
      const path = [...s.path.slice(0, depth + 1), child]
      return { path, paramsByTool: withMaterialized(s.paramsByTool, path) }
    }),

  selectToolById: (id) =>
    set((s) => {
      const found = findToolPath(TOOL_TREE, id)
      if (!found) return s
      return { path: found, paramsByTool: withMaterialized(s.paramsByTool, found) }
    }),

  reset: () => set({ path: [] }),

  setToolParams: (toolId, patch) =>
    set((s) => {
      const tool = TOOL_BY_ID.get(toolId)
      const merged = { ...resolveParams(tool?.params, s.paramsByTool[toolId]), ...patch }
      const resolved = tool?.normalizeParams ? tool.normalizeParams(merged, patch) : merged
      return { paramsByTool: { ...s.paramsByTool, [toolId]: resolved } }
    }),
}))

/** The resolved active tool (the last node of the path, if it is a leaf). */
export function selectActiveTool(s: ToolsState): ToolLeaf | null {
  const last = s.path[s.path.length - 1]
  return last && last.type === "tool" ? last : null
}

export const useActiveTool = (): ToolLeaf | null => useToolsStore(selectActiveTool)

/**
 * A tool's complete param bag. Safe for any tool id: falls back to resolving
 * spec defaults for tools that were never selected.
 */
export function getToolParams(toolId: string): ToolParamValues {
  const stored = useToolsStore.getState().paramsByTool[toolId]
  return stored ?? resolveParams(TOOL_BY_ID.get(toolId)?.params)
}

/** Reactive read of one param value; re-renders only when that value changes. */
export function useToolParam<T>(toolId: string, paramKey: string): T {
  return useToolsStore((s) => s.paramsByTool[toolId]?.[paramKey]) as T
}
