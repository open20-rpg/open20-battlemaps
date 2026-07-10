import { Flex, Icon, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { Tooltip } from "./ui/tooltip"
import { ObjectPreview } from "./ObjectPreview"
import { CustomColorControl } from "./CustomColorControl"
import { LayerControl } from "./LayerControl"
import { SortingControl } from "./SortingControl"
import { SwitchParamControl } from "./SwitchParamControl"
import { ShapeControl } from "./ShapeControl"
import { BrushSizeControl } from "./BrushSizeControl"
import { EditPointsControl } from "./EditPointsControl"
import { ToggleTextControl } from "./ToggleTextControl"
import { SliderControl } from "./SliderControl"
import { AssetPickerControl } from "./AssetPickerControl"
import { TOOL_TREE, paramGrows, type ToolNode, type ToolParamSpec } from "../lib/tools"
import { useTools } from "../context/tools"

const BAR_W = "46px"

// -- icon button ---------------------------------------------------------------

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

// -- vertical icon bar ---------------------------------------------------------

interface IconBarProps {
  nodes: ToolNode[]
  selectedId?: string
  onSelect: (node: ToolNode) => void
}

function IconBar({ nodes, selectedId, onSelect }: IconBarProps) {
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

// -- group panel (expanded = icon+text, collapsed = icon-only) -----------------

interface GroupPanelProps {
  group: Extract<ToolNode, { type: "group" }>
  expanded: boolean
  selectedChildId?: string
  onSelect: (child: ToolNode) => void
}

function GroupPanel({ group, expanded, selectedChildId, onSelect }: GroupPanelProps) {
  const { t } = useTranslation()

  if (!expanded) {
    // Collapsed: just the icons, with the picked child highlighted.
    return (
      <IconBar nodes={group.children} selectedId={selectedChildId} onSelect={onSelect} />
    )
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
            </Flex>
          )
        })}
      </VStack>
    </VStack>
  )
}

// -- tool parameters panel -----------------------------------------------------

/** Render a single declared param using the matching reusable control. */
function ToolParamControl({ toolId, spec }: { toolId: string; spec: ToolParamSpec }) {
  switch (spec.kind) {
    case "customColor":
      return <CustomColorControl toolId={toolId} />
    case "layer":
      return <LayerControl toolId={toolId} allowed={spec.allowed} defaultValue={spec.default} />
    case "sorting":
      return <SortingControl toolId={toolId} defaultValue={spec.default} />
    case "switch":
      return (
        <SwitchParamControl
          toolId={toolId}
          paramKey={spec.paramKey}
          labelKey={spec.labelKey}
          defaultValue={spec.default}
        />
      )
    case "toggleText":
      return (
        <ToggleTextControl
          toolId={toolId}
          paramKey={spec.paramKey}
          trueLabelKey={spec.trueLabelKey}
          falseLabelKey={spec.falseLabelKey}
          icon={spec.icon}
          defaultValue={spec.default}
        />
      )
    case "slider":
      return (
        <SliderControl
          toolId={toolId}
          paramKey={spec.paramKey}
          labelKey={spec.labelKey}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          defaultValue={spec.default}
        />
      )
    case "shape":
      return <ShapeControl toolId={toolId} defaultValue={spec.default} />
    case "brushSize":
      return (
        <BrushSizeControl
          toolId={toolId}
          ui={spec.ui}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          defaultValue={spec.default}
        />
      )
    case "editPoints":
      return <EditPointsControl toolId={toolId} defaultValue={spec.default} />
    case "assetPicker":
      return (
        <AssetPickerControl
          toolId={toolId}
          paramKey={spec.paramKey}
          labelKey={spec.labelKey}
          category={spec.category}
          select={spec.select}
          defaultColor={spec.defaultColor}
          allowNull={spec.allowNull}
        />
      )
  }
}

/** Stable-ish key for a param, so toggling visibility doesn't reshuffle others. */
function paramKeyOf(spec: ToolParamSpec, i: number): string {
  return "paramKey" in spec ? `${spec.kind}:${spec.paramKey}` : `${spec.kind}:${i}`
}

function ParamsPanel({ tool }: { tool: Extract<ToolNode, { type: "tool" }> }) {
  const { t } = useTranslation()
  const { getToolParams } = useTools()
  // Filter out params hidden by their visibleWhen predicate for the current
  // values (e.g. Portal shows Rotate 180 or Rotation depending on `anchored`).
  const values = getToolParams(tool.id)
  const params = (tool.params ?? []).filter((s) => !s.visibleWhen || s.visibleWhen(values))
  return (
    <VStack
      w="308px"
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
        <Icon as={tool.icon} color="brand.fg" boxSize="4" />
        <Text fontWeight="bold" fontSize="sm" truncate>
          {t(tool.nameKey)}
        </Text>
      </Flex>
      {params.length > 0 ? (
        // When a param grows (e.g. an asset picker), the column must not scroll
        // so the growing children can flex; otherwise let compact params scroll.
        <VStack
          align="stretch"
          gap="0"
          flex="1"
          minH="0"
          overflowY={params.some(paramGrows) ? "hidden" : "auto"}
        >
          {params.map((spec, i) => {
            const grows = paramGrows(spec)
            return (
              <Flex
                key={paramKeyOf(spec, i)}
                direction="column"
                flex={grows ? "1" : undefined}
                minH={grows ? "0" : undefined}
                flexShrink={grows ? 1 : 0}
              >
                <ToolParamControl toolId={tool.id} spec={spec} />
              </Flex>
            )
          })}
        </VStack>
      ) : (
        <Flex flex="1" align="center" justify="center" p="6">
          <Text fontSize="xs" color="fg.muted" textAlign="center">
            {t("tools.emptyParams")}
          </Text>
        </Flex>
      )}
    </VStack>
  )
}

// -- the whole sticky tools panel ----------------------------------------------

export function ToolsPanel() {
  // Selection lives in global state so features can read/set the active tool.
  const { path, selectTop, selectChild } = useTools()

  return (
    <Flex
      position="absolute"
      left="0"
      top="0"
      bottom="0"
      zIndex="docked"
      maxW="80%"
    >
      <IconBar nodes={TOOL_TREE} selectedId={path[0]?.id} onSelect={selectTop} />
      {path.map((node, i) => {
        if (node.type === "group") {
          return (
            <GroupPanel
              key={`${i}-${node.id}`}
              group={node}
              expanded={i === path.length - 1}
              selectedChildId={path[i + 1]?.id}
              onSelect={(child) => selectChild(i, child)}
            />
          )
        }
        return <ParamsPanel key={`${i}-${node.id}`} tool={node} />
      })}
      {/* Hover/press preview, pinned just to the right of the whole panel. */}
      <ObjectPreview />
    </Flex>
  )
}
