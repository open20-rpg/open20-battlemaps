import { Flex, Icon, Text, VStack } from "@chakra-ui/react"
import { formatShortcut } from "../../../lib/shortcuts"
import { useTranslation } from "react-i18next"
import { type ToolGroup, type ToolNode } from "../definitions"
import { IconBar } from "./IconBar"

interface GroupPanelProps {
  group: ToolGroup
  expanded: boolean
  selectedChildId?: string
  onSelect: (child: ToolNode) => void
}

/** A group's children: expanded = icon+text rows, collapsed = icon-only bar. */
export function GroupPanel({ group, expanded, selectedChildId, onSelect }: GroupPanelProps) {
  const { t } = useTranslation()

  if (!expanded) {
    // Collapsed: just the icons, with the picked child highlighted.
    return <IconBar nodes={group.children} selectedId={selectedChildId} onSelect={onSelect} />
  }

  return (
    <VStack
      w="210px"
      h="full"
      flexShrink={0}
      gap="0"
      align="stretch"
      bg="panel.bg"
      borderRightWidth="1px"
      borderColor="panel.border"
    >
      <Flex
        align="center"
        gap="2"
        px="3"
        py="2.5"
        borderBottomWidth="1px"
        borderColor="panel.border"
        bg="panel.header"
        flexShrink={0}
      >
        <Icon as={group.icon} color="brand.fg" boxSize="4" />
        <Text fontWeight="bold" fontSize="sm" truncate>
          {t(group.nameKey)}
        </Text>
      </Flex>
      <VStack gap="1" p="2" align="stretch" overflowY="auto">
        {group.children.map((child) => {
          const active = selectedChildId === child.id
          return (
            <Flex
              key={child.id}
              as="button"
              align="center"
              gap="2.5"
              px="2.5"
              py="2"
              borderRadius="md"
              color={active ? "brand.fg" : "menubar.fg"}
              bg={active ? "panel.rowSelected" : "transparent"}
              _hover={{ bg: active ? "panel.rowSelected" : "panel.rowHover" }}
              onClick={() => onSelect(child)}
            >
              <Icon as={child.icon} boxSize="5" flexShrink={0} />
              <Text fontSize="sm" textAlign="left" truncate>
                {t(child.nameKey)}
              </Text>
              {child.type === "tool" && child.shortcut && (
                <Text ml="auto" fontSize="xs" color="fg.muted" flexShrink={0}>
                  {formatShortcut(child.shortcut)}
                </Text>
              )}
            </Flex>
          )
        })}
      </VStack>
    </VStack>
  )
}
