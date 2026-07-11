import { Flex, Icon, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { Tooltip } from "../../../ui/chakra/tooltip"
import { type ToolNode } from "../definitions"

export const BAR_W = "46px"

interface ToolIconProps {
  node: ToolNode
  active: boolean
  onClick: () => void
  withTooltip?: boolean
}

function ToolIcon({ node, active, onClick, withTooltip = true }: ToolIconProps) {
  const { t } = useTranslation()
  const label = t(node.nameKey)
  const button = (
    <Flex
      as="button"
      align="center"
      justify="center"
      boxSize="38px"
      borderRadius="md"
      flexShrink={0}
      color={active ? "brand.fg" : "menubar.fg"}
      bg={active ? "panel.rowSelected" : "transparent"}
      _hover={{ bg: active ? "panel.rowSelected" : "panel.rowHover" }}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon as={node.icon} boxSize="5" />
    </Flex>
  )
  if (!withTooltip) return button
  return (
    <Tooltip content={label} positioning={{ placement: "right" }} openDelay={200} showArrow>
      {button}
    </Tooltip>
  )
}

interface IconBarProps {
  nodes: ToolNode[]
  selectedId?: string
  onSelect: (node: ToolNode) => void
}

/** Vertical icon-only bar; used for the top level and collapsed groups. */
export function IconBar({ nodes, selectedId, onSelect }: IconBarProps) {
  return (
    <VStack
      w={BAR_W}
      h="full"
      flexShrink={0}
      gap="1"
      py="2"
      bg="panel.header"
      borderRightWidth="1px"
      borderColor="panel.border"
      overflowY="auto"
    >
      {nodes.map((node) => (
        <ToolIcon
          key={node.id}
          node={node}
          active={selectedId === node.id}
          onClick={() => onSelect(node)}
        />
      ))}
    </VStack>
  )
}
