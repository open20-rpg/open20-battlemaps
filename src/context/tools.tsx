import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { TOOL_TREE, findToolPath, type ToolLeaf, type ToolNode } from "../lib/tools"

/** Arbitrary per-tool parameter bag; shape is defined by each tool later. */
export type ToolParams = Record<string, unknown>

interface ToolsContextValue {
  /** The selection chain, from the top-level pick inward. Drives the panels. */
  path: ToolNode[]
  /** The resolved active tool (the last node, if it is a leaf tool). */
  activeTool: ToolLeaf | null
  activeToolId: string | null
  /** Select a top-level node (toggles off if it is already the current top). */
  selectTop: (node: ToolNode) => void
  /** Select a child of the group at `depth`, replacing anything deeper. */
  selectChild: (depth: number, child: ToolNode) => void
  /** Select any tool by id (e.g. from a keyboard shortcut or a feature). */
  selectToolById: (id: string) => void
  /** Clear the current selection. */
  reset: () => void
  /** Read the parameters of a tool (defaults to an empty object). */
  getToolParams: (toolId: string) => ToolParams
  /** Merge a patch into a tool's parameters. */
  setToolParams: (toolId: string, patch: ToolParams) => void
}

const ToolsContext = createContext<ToolsContextValue | null>(null)

/**
 * Holds the currently selected tool and per-tool parameters in global state so
 * both the tools UI and future editor features can read and change them.
 */
export function ToolsProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<ToolNode[]>([])
  const [paramsByTool, setParamsByTool] = useState<Record<string, ToolParams>>({})

  const last = path[path.length - 1]
  const activeTool = last && last.type === "tool" ? last : null

  const selectTop = useCallback((node: ToolNode) => {
    setPath((prev) => (prev[0]?.id === node.id ? [] : [node]))
  }, [])

  const selectChild = useCallback((depth: number, child: ToolNode) => {
    setPath((prev) => [...prev.slice(0, depth + 1), child])
  }, [])

  const selectToolById = useCallback((id: string) => {
    const found = findToolPath(TOOL_TREE, id)
    if (found) setPath(found)
  }, [])

  const reset = useCallback(() => setPath([]), [])

  const getToolParams = useCallback(
    (toolId: string) => paramsByTool[toolId] ?? {},
    [paramsByTool],
  )

  const setToolParams = useCallback((toolId: string, patch: ToolParams) => {
    setParamsByTool((prev) => ({ ...prev, [toolId]: { ...(prev[toolId] ?? {}), ...patch } }))
  }, [])

  const value = useMemo<ToolsContextValue>(
    () => ({
      path,
      activeTool,
      activeToolId: activeTool?.id ?? null,
      selectTop,
      selectChild,
      selectToolById,
      reset,
      getToolParams,
      setToolParams,
    }),
    [path, activeTool, selectTop, selectChild, selectToolById, reset, getToolParams, setToolParams],
  )

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>
}

export function useTools(): ToolsContextValue {
  const ctx = useContext(ToolsContext)
  if (!ctx) {
    throw new Error("useTools must be used within a <ToolsProvider>")
  }
  return ctx
}
