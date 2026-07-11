import { type ToolBehavior } from "./types"

export type { PointerInfo, ToolBehavior, ToolCtx } from "./types"

/**
 * Behavior registry, keyed by tool id (the same ids as TOOL_TREE). Adding a
 * tool to the editor means: (1) its data entry in definitions.ts, (2) its
 * behavior here, (3) its i18n keys. The future viewport dispatches pointer
 * events to the active tool's behavior via {@link getToolBehavior}.
 *
 * Empty until the editor lands — register behaviors as tools become real.
 */
export const TOOL_BEHAVIORS: Record<string, ToolBehavior> = {}

export function getToolBehavior(toolId: string): ToolBehavior | undefined {
  return TOOL_BEHAVIORS[toolId]
}
