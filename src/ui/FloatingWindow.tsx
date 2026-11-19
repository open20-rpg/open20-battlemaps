import { useEffect, useRef, useState, type ReactNode } from "react"
import { Box, Flex, Icon, IconButton, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import type { IconType } from "react-icons"
import { LuGripHorizontal, LuX } from "react-icons/lu"
import { ModalLayer } from "./Modal"
import { keepOnScreen, openingRect, type WindowRect } from "../lib/windowLayout"

interface Size {
  w: number
  h: number
}

const viewport = () => ({ w: window.innerWidth, h: window.innerHeight })

/** Touch (and pen) screens: bigger handles to grab. */
const COARSE = "@media (pointer: coarse)"

export interface FloatingWindowProps {
  title: string
  icon?: IconType
  onClose: () => void
  /** Initial top-left position in px (default: centered). */
  initialPosition?: { x: number; y: number }
  /** Preferred size in px (shrunk to fit the screen). */
  initialSize?: Size
  /** Smallest size the user can resize down to. */
  minSize?: Size
  /** Show a bottom-right resize handle. */
  resizable?: boolean
  /** Optional toolbar rendered under the title bar. */
  toolbar?: ReactNode
  /** When true, render a backdrop that blocks interaction with the rest of the app. */
  modal?: boolean
  /** Close the window when the modal backdrop is clicked (default true). */
  closeOnBackdropClick?: boolean
  children: ReactNode
}

/**
 * A draggable, optionally resizable/modal floating panel with a title bar.
 * Reused for every tool window in the app (assets, preferences, …). It
 * opens at a comfortable size and place (its preferred size, centered,
 * shrunk to fit a phone) and stays wholly on screen while dragged, resized
 * or when the window changes size. On touch screens the title bar and the
 * resize corner are bigger to grab. Layering (and the backdrop for `modal`)
 * is handled by the modal stack, not by z-index — see {@link ModalLayer}.
 */
export function FloatingWindow({
  title,
  icon,
  onClose,
  initialPosition,
  initialSize = { w: 520, h: 560 },
  minSize = { w: 320, h: 260 },
  resizable = false,
  toolbar,
  modal = false,
  closeOnBackdropClick = true,
  children,
}: FloatingWindowProps) {
  const { t } = useTranslation()
  const [rect, setRect] = useState<WindowRect>(() =>
    openingRect(viewport(), initialSize, minSize, initialPosition),
  )

  // The app window shrinking (or a phone turning) never leaves it off screen.
  useEffect(() => {
    const onResize = () => setRect((r) => keepOnScreen(viewport(), r))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  /** Where a drag (move or resize) started: pointer and window. */
  const start = useRef<{ px: number; py: number; rect: WindowRect } | null>(null)
  const begin = (e: React.PointerEvent) => {
    start.current = { px: e.clientX, py: e.clientY, rect }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const end = (e: React.PointerEvent) => {
    start.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  }

  const moveHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      // Don't start a drag from an interactive control in the title bar.
      if ((e.target as HTMLElement).closest("button")) return
      begin(e)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current
      if (!s) return
      setRect(
        keepOnScreen(viewport(), {
          ...s.rect,
          x: s.rect.x + e.clientX - s.px,
          y: s.rect.y + e.clientY - s.py,
        }),
      )
    },
    onPointerUp: end,
    onPointerCancel: end,
  }

  const resizeHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation()
      begin(e)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current
      if (!s) return
      const room = viewport()
      setRect(
        keepOnScreen(room, {
          ...s.rect,
          w: Math.max(Math.min(minSize.w, room.w), s.rect.w + e.clientX - s.px),
          h: Math.max(Math.min(minSize.h, room.h), s.rect.h + e.clientY - s.py),
        }),
      )
    },
    onPointerUp: end,
    onPointerCancel: end,
  }

  const windowBox = (
    <Box
      position="fixed"
      left={`${rect.x}px`}
      top={`${rect.y}px`}
      w={`${rect.w}px`}
      h={`${rect.h}px`}
      // Non-modal windows float over the editor (modal ones get their layer).
      zIndex={modal ? undefined : "overlay"}
      bg="panel.bg"
      borderWidth="1px"
      borderColor="panel.border"
      borderRadius="lg"
      boxShadow="lg"
      display="flex"
      flexDirection="column"
      overflow="hidden"
    >
      <Flex
        align="center"
        gap="2"
        px="3"
        py="2.5"
        bg="panel.header"
        borderBottomWidth="1px"
        borderColor="panel.border"
        cursor="move"
        flexShrink={0}
        position="relative"
        // Stop the browser from claiming the touch gesture as a scroll/pan
        // (which fires pointercancel and kills the drag on touch devices).
        touchAction="none"
        css={{ [COARSE]: { paddingTop: "14px", paddingBottom: "14px" } }}
        {...moveHandlers}
      >
        {icon && <Icon as={icon} color="brand.fg" boxSize="4" />}
        <Text fontWeight="bold" fontSize="sm" flex="1" truncate>
          {title}
        </Text>
        {/* A visible grip on touch screens: the whole bar drags. */}
        <Icon
          as={LuGripHorizontal}
          position="absolute"
          left="50%"
          top="2px"
          transform="translateX(-50%)"
          boxSize="4"
          color="fg.muted"
          display="none"
          css={{ [COARSE]: { display: "block" } }}
        />
        <IconButton
          aria-label={t("assets.close")}
          size="xs"
          variant="ghost"
          onClick={onClose}
          css={{ [COARSE]: { minWidth: "36px", height: "36px" } }}
        >
          <LuX />
        </IconButton>
      </Flex>

      {toolbar}

      <Box flex="1" minH="0" display="flex" flexDirection="column" overflow="hidden">
        {children}
      </Box>

      {resizable && (
        <Box
          position="absolute"
          right="0"
          bottom="0"
          boxSize="16px"
          cursor="se-resize"
          zIndex={1}
          touchAction="none"
          {...resizeHandlers}
          css={{
            background:
              "linear-gradient(135deg, transparent 50%, var(--chakra-colors-panel-border) 50%, var(--chakra-colors-panel-border) 62%, transparent 62%, transparent 74%, var(--chakra-colors-panel-border) 74%, var(--chakra-colors-panel-border) 86%, transparent 86%)",
            [COARSE]: { width: "32px", height: "32px" },
          }}
        />
      )}
    </Box>
  )

  if (modal) {
    return (
      <ModalLayer open onClose={onClose} closeOnBackdrop={closeOnBackdropClick} centered={false}>
        {windowBox}
      </ModalLayer>
    )
  }

  return windowBox
}
