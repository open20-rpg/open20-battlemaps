import { Flex } from "@chakra-ui/react"
import { useToolsStore } from "../../stores/toolsStore"
import { ObjectPreview } from "../library/ObjectPreview"
import { TOOL_TREE } from "./definitions"
import { IconBar } from "./panels/IconBar"
import { GroupPanel } from "./panels/GroupPanel"
import { ParamsPanel } from "./panels/ParamsPanel"

/**
 * The sticky tools panel overlaid on the editor's left edge: the top-level
 * icon bar plus one panel per selected node (group lists or tool params).
 * Selection lives in the tools store so features can read/set the active tool.
 */
export function ToolsPanel() {
  const path = useToolsStore((s) => s.path)
  const selectTop = useToolsStore((s) => s.selectTop)
  const selectChild = useToolsStore((s) => s.selectChild)

  return (
    <Flex position="absolute" left="0" top="0" bottom="0" zIndex="docked" maxW="80%">
      <IconBar nodes={TOOL_TREE} selectedId={path[0]?.id} onSelect={selectTop} />
      {path.map((node, i) => {
        if (node.type === "group") {
          return (
            <GroupPanel
              key={node.id}
              group={node}
              expanded={i === path.length - 1}
              selectedChildId={path[i + 1]?.id}
              onSelect={(child) => selectChild(i, child)}
            />
          )
        }
        return <ParamsPanel key={node.id} tool={node} />
      })}
      {/* Hover/press preview, pinned just to the right of the whole panel. */}
      <ObjectPreview />
    </Flex>
  )
}
