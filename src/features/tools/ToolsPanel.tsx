import { Flex } from "@chakra-ui/react"
import { useActiveTool, useToolsStore } from "../../stores/toolsStore"
import { ObjectPreview } from "../library/ObjectPreview"
import { TOOL_TREE, type ToolNode } from "./definitions"
import { IconBar } from "./panels/IconBar"
import { GroupPanel } from "./panels/GroupPanel"
import { ParamsPanel } from "./panels/ParamsPanel"
import { ViewControlsBar } from "../viewport/ViewControlsBar"

/**
 * The sticky tools panel overlaid on the editor's left edge: the top-level
 * icon bar plus one panel per selected node (group lists or tool params).
 * Selection lives in the tools store so features can read/set the active tool.
 *
 * Clicking the active tool's own button (its top-level icon or its group row)
 * toggles the params panel instead of re-selecting it, mirroring the hide
 * button in the panel header.
 */
export function ToolsPanel() {
  const path = useToolsStore((s) => s.path)
  const selectTop = useToolsStore((s) => s.selectTop)
  const selectChild = useToolsStore((s) => s.selectChild)
  const toggleParams = useToolsStore((s) => s.toggleParams)
  const paramsCollapsed = useToolsStore((s) => s.paramsCollapsed)
  const activeTool = useActiveTool()

  const selectTopOrToggle = (node: ToolNode) => {
    if (node.type === "tool" && node.id === activeTool?.id) toggleParams()
    else selectTop(node)
  }
  const selectChildOrToggle = (depth: number, child: ToolNode) => {
    if (child.id === activeTool?.id) toggleParams()
    else selectChild(depth, child)
  }

  return (
    <Flex position="absolute" left="0" top="0" bottom="0" zIndex="docked" maxW="80%">
      <IconBar
        nodes={TOOL_TREE}
        selectedId={path[0]?.id}
        onSelect={selectTopOrToggle}
        footer={<ViewControlsBar />}
      />
      {path.map((node, i) => {
        if (node.type === "group") {
          return (
            <GroupPanel
              key={node.id}
              group={node}
              expanded={i === path.length - 1}
              selectedChildId={path[i + 1]?.id}
              onSelect={(child) => selectChildOrToggle(i, child)}
            />
          )
        }
        // The active tool's params — hidden while collapsed (tool stays active).
        return paramsCollapsed ? null : (
          <ParamsPanel key={node.id} tool={node} onHide={toggleParams} />
        )
      })}
      {/* Hover/press preview, pinned just to the right of the whole panel. */}
      <ObjectPreview />
    </Flex>
  )
}
