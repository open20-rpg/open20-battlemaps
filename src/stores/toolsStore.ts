import { create } from "zustand"
import {
  TOOL_BY_ID,
  TOOL_TREE,
  findToolPath,
  mergeToolTree,
  type ExtraTool,
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
  /**
   * Whether the active tool's params panel is hidden. The tool stays selected
   * (library, cursor, …); only the params column is collapsed. Reset whenever
   * a different tool is selected so a new tool always shows its params.
   */
  paramsCollapsed: boolean
  /** Select a top-level node (toggles off if it is already the current top). */
  selectTop: (node: ToolNode) => void
  /** Select a child of the group at `depth`, replacing anything deeper. */
  selectChild: (depth: number, child: ToolNode) => void
  /** Select any tool by id (e.g. from a keyboard shortcut or a feature). */
  selectToolById: (id: string) => void
  /** Clear the current selection. */
  reset: () => void
  /** Clear the selection and drop every tool's parameter bag (e.g. for a new map). */
  resetAll: () => void
  /** Show/hide the active tool's params panel. */
  toggleParams: () => void
  /** Merge a patch into a tool's parameters (normalizer applied in the same update). */
  setToolParams: (toolId: string, patch: ToolParamValues) => void
  /** Extensions' tools (see features/extensions/tools.ts) and the palette with them. */
  extraTools: readonly ExtraTool[]
  tree: ToolNode[]
  setExtraTools: (extras: readonly ExtraTool[]) => void
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

/** The tool active by default (and when the active one is turned off): Select. */
const DEFAULT_PATH: ToolNode[] = findToolPath(TOOL_TREE, "select") ?? []

export const useToolsStore = create<ToolsState>()((set) => ({
  path: DEFAULT_PATH,
  paramsByTool: withMaterialized({}, DEFAULT_PATH),
  paramsCollapsed: false,

  selectTop: (node) =>
    set((s) => {
      const path = s.path[0]?.id === node.id ? DEFAULT_PATH : [node]
      return { path, paramsByTool: withMaterialized(s.paramsByTool, path), paramsCollapsed: false }
    }),

  selectChild: (depth, child) =>
    set((s) => {
      const path = [...s.path.slice(0, depth + 1), child]
      return { path, paramsByTool: withMaterialized(s.paramsByTool, path), paramsCollapsed: false }
    }),

  selectToolById: (id) =>
    set((s) => {
      const found = findToolPath(s.tree, id)
      if (!found) return s
      return {
        path: found,
        paramsByTool: withMaterialized(s.paramsByTool, found),
        paramsCollapsed: false,
      }
    }),

  reset: () => set({ path: DEFAULT_PATH, paramsCollapsed: false }),

  resetAll: () =>
    set({
      path: DEFAULT_PATH,
      paramsCollapsed: false,
      paramsByTool: withMaterialized({}, DEFAULT_PATH),
    }),

  toggleParams: () => set((s) => ({ paramsCollapsed: !s.paramsCollapsed })),

  extraTools: [],
  tree: TOOL_TREE,
  setExtraTools: (extras) =>
    set((s) => {
      const tree = mergeToolTree(TOOL_TREE, extras)
      const ids = new Set(extras.map((x) => x.leaf.id))
      // A removed extension tool that was active: back to the default tool.
      const last = s.path[s.path.length - 1]
      const gone = last?.type === "tool" && last.id.startsWith("ext:") && !ids.has(last.id)
      // Keep the path's nodes in sync with the new tree (groups were rebuilt).
      const path = gone ? DEFAULT_PATH : last ? (findToolPath(tree, last.id) ?? s.path) : s.path
      return {
        extraTools: extras,
        tree,
        path,
        paramsByTool: withMaterialized(s.paramsByTool, path),
      }
    }),

  setToolParams: (toolId, patch) =>
    set((s) => {
      const stored = s.paramsByTool[toolId]
      // Nothing changes (e.g. the wheel at a slider's end): keep the state
      // as is, so nothing re-renders.
      if (stored && Object.entries(patch).every(([k, v]) => Object.is(stored[k], v))) return s
      const tool = toolById(toolId, s.extraTools)
      const merged = { ...resolveParams(tool?.params, stored), ...patch }
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
  const s = useToolsStore.getState()
  const stored = s.paramsByTool[toolId]
  return stored ?? resolveParams(toolById(toolId, s.extraTools)?.params)
}

/** A tool by id: a core one or an extension's. */
export function toolById(
  id: string,
  extras = useToolsStore.getState().extraTools,
): ToolLeaf | undefined {
  return TOOL_BY_ID.get(id) ?? extras.find((x) => x.leaf.id === id)?.leaf
}

/** The palette (core tools plus extensions'), as a hook. */
export const useToolTree = (): ToolNode[] => useToolsStore((s) => s.tree)
