import { useRef, useState } from "react"
import { Box, Flex, HStack, Icon, IconButton, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuChevronDown, LuChevronLeft, LuChevronUp, LuLayers } from "react-icons/lu"
import { useActiveTool, useToolsStore } from "../../stores/toolsStore"
import { LibraryPanel } from "../library/LibraryPanel"
import { ViewControlsBar } from "../viewport/ViewControlsBar"
import { TOOL_TREE, type ToolGroup, type ToolLeaf, type ToolNode } from "./definitions"
import { ToolIcon } from "./panels/IconBar"
import { ParamsPanel } from "./panels/ParamsPanel"

/** The sheet's resting heights, as fractions of the window's height. */
const SHEET_HALF = 0.42
const SHEET_FULL = 0.8
/** Height of the sheet's title bar (all that shows while it's lowered). */
const SHEET_HEAD_PX = 44

type SheetSize = "half" | "full"

/**
 * The tools on a phone, laid out to leave the map as much of the screen as
 * possible: one bar of tools along the bottom (a group's tools replace the
 * top level in it, with a way back), the active tool's params in a sheet
 * that can be lowered to its title or dragged up to half or most of the
 * screen, and the view controls folded into one floating button.
 */
export function MobileToolsPanel() {
  const path = useToolsStore((s) => s.path)
  const selectTop = useToolsStore((s) => s.selectTop)
  const selectChild = useToolsStore((s) => s.selectChild)
  const toggleParams = useToolsStore((s) => s.toggleParams)
  const lowered = useToolsStore((s) => s.paramsCollapsed)
  const activeTool = useActiveTool()
  const [size, setSize] = useState<SheetSize>("half")
  const [showTop, setShowTop] = useState(false)

  const group = path[0]?.type === "group" ? path[0] : null
  const leaf = path.find((n): n is ToolLeaf => n.type === "tool")
  const browsing = group && !showTop ? group : null

  const pickTop = (node: ToolNode) => {
    setShowTop(false)
    if (node.type === "tool" && node.id === activeTool?.id) toggleParams()
    else {
      setSize("half")
      selectTop(node)
    }
  }
  const pickChild = (child: ToolNode) => {
    if (child.id === activeTool?.id) toggleParams()
    else {
      setSize("half")
      selectChild(0, child)
    }
  }

  return (
    <>
      <ViewControlsButton />
      <Flex position="absolute" left="0" right="0" bottom="0" zIndex="docked" direction="column">
        {leaf && (
          <Sheet
            tool={leaf}
            lowered={lowered}
            size={size}
            onSize={(next) => {
              if (next === "lowered") {
                if (!lowered) toggleParams()
                return
              }
              setSize(next)
              if (lowered) toggleParams()
            }}
          />
        )}
        <ToolRow
          group={browsing}
          selectedId={(browsing ? path[1] : path[0])?.id}
          onPick={(node) => (browsing ? pickChild(node) : pickTop(node))}
          onBack={() => setShowTop(true)}
        />
      </Flex>
    </>
  )
}

/** The bottom bar: the top level, or a group's tools with a way back. */
function ToolRow({
  group,
  selectedId,
  onPick,
  onBack,
}: {
  group: ToolGroup | null
  selectedId?: string
  onPick: (node: ToolNode) => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const nodes = group ? group.children : TOOL_TREE
  return (
    <HStack
      gap="1"
      px="1.5"
      pt="1"
      flexShrink={0}
      bg="panel.header"
      borderTopWidth="1px"
      borderColor="panel.border"
      // Clear of the phone's gesture bar.
      pb="max(4px, env(safe-area-inset-bottom))"
    >
      {group && (
        <Flex
          as="button"
          align="center"
          gap="1"
          pl="1"
          pr="2"
          h="38px"
          flexShrink={0}
          borderRadius="md"
          color="brand.fg"
          bg="panel.rowSelected"
          onClick={onBack}
          aria-label={t("tools.backToGroups")}
        >
          <Icon as={LuChevronLeft} boxSize="4" />
          <Icon as={group.icon} boxSize="5" />
        </Flex>
      )}
      <HStack
        gap="1"
        flex="1"
        minW="0"
        overflowX="auto"
        css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
      >
        {nodes.map((node) => (
          <ToolIcon
            key={node.id}
            node={node}
            active={selectedId === node.id}
            onClick={() => onPick(node)}
            withTooltip={false}
          />
        ))}
      </HStack>
    </HStack>
  )
}

/**
 * The active tool's params (and Library, for tools that place library
 * items) in a sheet over the map. Its title bar lowers or raises it on a
 * tap and resizes it on a drag, settling at the nearest of lowered, half
 * and most of the screen.
 */
function Sheet({
  tool,
  lowered,
  size,
  onSize,
}: {
  tool: ToolLeaf
  lowered: boolean
  size: SheetSize
  onSize: (size: SheetSize | "lowered") => void
}) {
  const { t } = useTranslation()
  const toggleParams = useToolsStore((s) => s.toggleParams)
  const [tab, setTab] = useState<"params" | "library">("params")
  /** The height being dragged to (px), while dragging. */
  const [dragH, setDragH] = useState<number | null>(null)
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null)

  const library = tool.library
  const showing = library ? tab : "params"
  const restH = lowered
    ? SHEET_HEAD_PX
    : Math.round(window.innerHeight * (size === "full" ? SHEET_FULL : SHEET_HALF))
  const height = dragH ?? restH

  const settle = (h: number) => {
    const options: [SheetSize | "lowered", number][] = [
      ["lowered", SHEET_HEAD_PX],
      ["half", window.innerHeight * SHEET_HALF],
      ["full", window.innerHeight * SHEET_FULL],
    ]
    const [nearest] = options.reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a))
    onSize(nearest)
  }

  return (
    <Flex
      direction="column"
      h={`${height}px`}
      bg="panel.bg"
      borderTopWidth="1px"
      borderColor="panel.border"
      borderTopRadius="xl"
      overflow="hidden"
      transition={dragH === null ? "height 0.18s ease-out" : undefined}
    >
      <Flex
        direction="column"
        flexShrink={0}
        h={`${SHEET_HEAD_PX}px`}
        bg="panel.header"
        touchAction="none"
        cursor="grab"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, h: height, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dy = d.y - e.clientY
          if (!d.moved && Math.abs(dy) < 6) return
          d.moved = true
          setDragH(Math.max(SHEET_HEAD_PX, Math.min(window.innerHeight * 0.9, d.h + dy)))
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          if (!d) return
          if (d.moved && dragH !== null) settle(dragH)
          // A tap raises a lowered sheet and lowers a raised one.
          else toggleParams()
          setDragH(null)
        }}
        onPointerCancel={() => {
          drag.current = null
          setDragH(null)
        }}
      >
        <Box mx="auto" mt="1.5" w="9" h="1" borderRadius="full" bg="panel.border" />
        <Flex flex="1" align="center" gap="2" px="3">
          <Icon as={tool.icon} color="brand.fg" boxSize="4" />
          <Text truncate fontWeight="bold" fontSize="sm" flex="1">
            {t(tool.nameKey)}
          </Text>
          {library && !lowered && (
            <HStack gap="1" onPointerDown={(e) => e.stopPropagation()}>
              {(["params", "library"] as const).map((id) => (
                <Flex
                  key={id}
                  as="button"
                  px="2.5"
                  py="1"
                  borderRadius="md"
                  fontSize="xs"
                  fontWeight="medium"
                  color={showing === id ? "brand.fg" : "menubar.fg"}
                  bg={showing === id ? "panel.rowSelected" : "transparent"}
                  onClick={() => setTab(id)}
                >
                  {t(id === "params" ? "tools.paramsTab" : "library.title")}
                </Flex>
              ))}
            </HStack>
          )}
          <IconButton
            aria-label={t(lowered ? "tools.showParams" : "tools.hideParams")}
            size="xs"
            variant="ghost"
            color="menubar.fg"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onSize(lowered ? "half" : size === "half" ? "full" : "lowered")}
          >
            {lowered || size === "half" ? <LuChevronUp /> : <LuChevronDown />}
          </IconButton>
        </Flex>
      </Flex>
      {!lowered &&
        (showing === "library" && library ? (
          <LibraryPanel category={library} embedded />
        ) : (
          <Flex flex="1" minH="0">
            <ParamsPanel tool={tool} onHide={toggleParams} width="100%" scroll header={false} />
          </Flex>
        ))}
    </Flex>
  )
}

/** The view controls folded into one floating button, unfolding into their column. */
function ViewControlsButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Flex
      position="absolute"
      top="2"
      right="2"
      // Over the sheet, even raised.
      zIndex="sticky"
      direction="column"
      align="center"
      bg="panel.header"
      borderWidth="1px"
      borderColor="panel.border"
      borderRadius="lg"
      overflow="hidden"
    >
      <IconButton
        aria-label={t("tools.viewControls")}
        aria-expanded={open}
        variant="ghost"
        color={open ? "brand.fg" : "menubar.fg"}
        onClick={() => setOpen((v) => !v)}
      >
        <LuLayers />
      </IconButton>
      {open && <ViewControlsBar />}
    </Flex>
  )
}
