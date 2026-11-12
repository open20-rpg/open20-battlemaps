import { useState } from "react"
import { Box, Flex, HStack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useActiveTool, useToolsStore } from "../../stores/toolsStore"
import { LibraryPanel } from "../library/LibraryPanel"
import { ViewControlsBar } from "../viewport/ViewControlsBar"
import { TOOL_TREE, type ToolNode } from "./definitions"
import { ToolIcon } from "./panels/IconBar"
import { ParamsPanel } from "./panels/ParamsPanel"

/** Height of the sheet with the active tool's params (or its library). */
const SHEET_H = "44vh"

/** A row of tool icons scrolling sideways (the phone layout's bars). */
function IconRow({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: ToolNode[]
  selectedId?: string
  onSelect: (node: ToolNode) => void
}) {
  return (
    <HStack
      gap="1"
      px="2"
      py="1.5"
      overflowX="auto"
      flexShrink={0}
      bg="panel.header"
      borderTopWidth="1px"
      borderColor="panel.border"
      css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
    >
      {nodes.map((node) => (
        <ToolIcon
          key={node.id}
          node={node}
          active={selectedId === node.id}
          onClick={() => onSelect(node)}
          withTooltip={false}
        />
      ))}
    </HStack>
  )
}

/**
 * The tools on a phone: the same TOOL_TREE as the desktop panel, laid out
 * for a narrow, tall screen — the top level as a bar along the bottom, a
 * group's tools in a bar above it, and the active tool's params (or, for
 * tools that place library items, the Library) in a sheet above those.
 * Tapping the active tool again shows or hides the sheet. The view controls
 * float at the top right.
 */
export function MobileToolsPanel() {
  const { t } = useTranslation()
  const path = useToolsStore((s) => s.path)
  const selectTop = useToolsStore((s) => s.selectTop)
  const selectChild = useToolsStore((s) => s.selectChild)
  const toggleParams = useToolsStore((s) => s.toggleParams)
  const paramsCollapsed = useToolsStore((s) => s.paramsCollapsed)
  const activeTool = useActiveTool()
  const [tab, setTab] = useState<"params" | "library">("params")

  const group = path[0]?.type === "group" ? path[0] : null
  const leaf = path.find((n) => n.type === "tool")
  const library = activeTool?.library
  const showing = library ? tab : "params"

  const selectTopOrToggle = (node: ToolNode) => {
    if (node.type === "tool" && node.id === activeTool?.id) toggleParams()
    else selectTop(node)
  }
  const selectChildOrToggle = (child: ToolNode) => {
    if (child.id === activeTool?.id) toggleParams()
    else selectChild(0, child)
  }

  return (
    <>
      <Box
        position="absolute"
        top="2"
        right="2"
        zIndex="docked"
        bg="panel.header"
        borderWidth="1px"
        borderColor="panel.border"
        borderRadius="lg"
        overflow="hidden"
      >
        <ViewControlsBar />
      </Box>
      <Flex position="absolute" left="0" right="0" bottom="0" zIndex="docked" direction="column">
        {leaf?.type === "tool" && !paramsCollapsed && (
          <Flex
            direction="column"
            h={SHEET_H}
            bg="panel.bg"
            borderTopWidth="1px"
            borderColor="panel.border"
          >
            {library && (
              <HStack gap="0" flexShrink={0} bg="panel.header">
                {(["params", "library"] as const).map((id) => (
                  <Flex
                    key={id}
                    as="button"
                    flex="1"
                    justify="center"
                    py="2"
                    fontSize="sm"
                    fontWeight="medium"
                    color={showing === id ? "brand.fg" : "menubar.fg"}
                    borderBottomWidth="2px"
                    borderColor={showing === id ? "brand.fg" : "transparent"}
                    onClick={() => setTab(id)}
                  >
                    <Text>{t(id === "params" ? "tools.paramsTab" : "library.title")}</Text>
                  </Flex>
                ))}
              </HStack>
            )}
            {showing === "library" && library ? (
              <LibraryPanel category={library} embedded />
            ) : (
              <Flex flex="1" minH="0">
                <ParamsPanel tool={leaf} onHide={toggleParams} width="100%" scroll />
              </Flex>
            )}
          </Flex>
        )}
        {group && (
          <IconRow nodes={group.children} selectedId={path[1]?.id} onSelect={selectChildOrToggle} />
        )}
        <IconRow nodes={TOOL_TREE} selectedId={path[0]?.id} onSelect={selectTopOrToggle} />
      </Flex>
    </>
  )
}
