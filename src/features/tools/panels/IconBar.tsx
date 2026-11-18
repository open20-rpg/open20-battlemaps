import { type ReactNode } from "react"
import { Box, Flex, Icon, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useActionBinding, withBinding } from "../../shortcuts/bindings"
import { Tooltip } from "../../../ui/chakra/tooltip"
import { type ToolNode } from "../definitions"
import { type ToolAlertId, useToolAlert } from "../alerts"

export const BAR_W = "46px"

interface ToolIconProps {
  node: ToolNode
  active: boolean
  onClick: () => void
  withTooltip?: boolean
}

/** Looks of a tool button: a plain tool, and an alert one (always stands out). */
const LOOKS = {
  plain: { color: "menubar.fg", bg: "transparent", hover: "panel.rowHover", border: undefined },
  alert: { color: "brand.fg", bg: "brand.subtle", hover: "brand.muted", border: "brand.fg/60" },
} as const

export function ToolIcon(props: ToolIconProps) {
  const alert = props.node.type === "tool" ? props.node.alert : undefined
  return alert ? <AlertToolIcon {...props} alert={alert} /> : <ToolButton {...props} />
}

/**
 * A tool that fixes a problem of the map: only there while the map has it
 * (or while it's in use), with how many to fix on it.
 */
function AlertToolIcon({ alert, ...props }: ToolIconProps & { alert: ToolAlertId }) {
  const { t } = useTranslation()
  const count = useToolAlert(alert)
  if (count === 0 && !props.active) return null
  return (
    <ToolButton
      {...props}
      alertCount={count}
      tipNote={count > 0 ? t(`tools.alert.${alert}`, { count }) : undefined}
    />
  )
}

function ToolButton({
  node,
  active,
  onClick,
  withTooltip = true,
  alertCount,
  tipNote,
}: ToolIconProps & { alertCount?: number; tipNote?: string }) {
  const { t } = useTranslation()
  const label = t(node.nameKey)
  const tip = withBinding(
    tipNote ? `${label} · ${tipNote}` : label,
    useActionBinding(`tool:${node.id}`),
  )
  const look = alertCount === undefined ? LOOKS.plain : LOOKS.alert
  const button = (
    <Flex
      as="button"
      position="relative"
      align="center"
      justify="center"
      boxSize="38px"
      borderRadius="md"
      flexShrink={0}
      color={active ? "brand.fg" : look.color}
      bg={active ? "panel.rowSelected" : look.bg}
      borderWidth={look.border ? "1px" : undefined}
      borderColor={look.border}
      _hover={{ bg: active ? "panel.rowSelected" : look.hover }}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon as={node.icon} boxSize="5" />
      {!!alertCount && <AlertBadge count={alertCount} />}
    </Flex>
  )
  if (!withTooltip) return button
  return (
    <Tooltip content={tip} positioning={{ placement: "right" }} openDelay={200} showArrow>
      {button}
    </Tooltip>
  )
}

/** The count on an alert tool, with a ping behind it until it's dealt with. */
function AlertBadge({ count }: { count: number }) {
  return (
    <Box position="absolute" top="-1" right="-1" pointerEvents="none">
      <Box
        position="absolute"
        inset="0"
        borderRadius="full"
        bg="brand.solid"
        animation="ping"
        _motionReduce={{ animation: "none" }}
      />
      <Flex
        position="relative"
        minW="4"
        h="4"
        px="1"
        align="center"
        justify="center"
        borderRadius="full"
        bg="brand.solid"
        color="brand.contrast"
        fontSize="2xs"
        fontWeight="bold"
        lineHeight="1"
        boxShadow="0 0 0 2px var(--chakra-colors-panel-header)"
      >
        {count > 99 ? "99+" : count}
      </Flex>
    </Box>
  )
}

interface IconBarProps {
  nodes: ToolNode[]
  selectedId?: string
  onSelect: (node: ToolNode) => void
  /** Optional bar pinned to the bottom (the view controls on the top-level bar). */
  footer?: ReactNode
}

/** Vertical icon-only bar; used for the top level and collapsed groups. */
export function IconBar({ nodes, selectedId, onSelect, footer }: IconBarProps) {
  return (
    <Flex
      direction="column"
      w={BAR_W}
      h="full"
      flexShrink={0}
      bg="panel.header"
      borderRightWidth="1px"
      borderColor="panel.border"
    >
      <VStack gap="1" py="2" flex="1" minH="0" overflowY="auto" align="center">
        {nodes.map((node) => (
          <ToolIcon
            key={node.id}
            node={node}
            active={selectedId === node.id}
            onClick={() => onSelect(node)}
          />
        ))}
      </VStack>
      {footer}
    </Flex>
  )
}
