import { useCallback, useRef, useState, type ReactNode } from "react"
import { Box, Flex, Icon, IconButton, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import type { IconType } from "react-icons"
import { LuX } from "react-icons/lu"
import { ModalLayer } from "./Modal"

interface Size {
  w: number
  h: number
}

function useDrag(initial: { x: number; y: number }) {
  const [pos, setPos] = useState(initial)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Don't start a drag from an interactive control in the title bar.
      if ((e.target as HTMLElement).closest("button")) return
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [pos],
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    const x = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx))
    const y = Math.max(0, Math.min(window.innerHeight - 48, e.clientY - drag.current.dy))
    setPos({ x, y })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  }, [])

  return { pos, handlers: { onPointerDown, onPointerMove, onPointerUp } }
}

export interface FloatingWindowProps {
  title: string
  icon?: IconType
  onClose: () => void
  /** Initial top-left position in px. */
  initialPosition?: { x: number; y: number }
  /** Initial size in px. */
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
 * Reused for every tool window in the app (assets, layers, properties, ...).
 * Layering (and the backdrop for `modal`) is handled by the modal stack, not
 * by z-index — see {@link ModalLayer}.
 */
export function FloatingWindow({
  title,
  icon,
  onClose,
  initialPosition = { x: 120, y: 90 },
  initialSize = { w: 520, h: 560 },
  minSize = { w: 320, h: 260 },
  resizable = false,
  toolbar,
  modal = false,
  closeOnBackdropClick = true,
  children,
}: FloatingWindowProps) {
  const { t } = useTranslation()
  const { pos, handlers } = useDrag(initialPosition)
  const [size, setSize] = useState<Size>(initialSize)

  // Bottom-right resize handle.
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const onResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [size],
  )
  const onResizeMove = useCallback(
    (e: React.PointerEvent) => {
      const s = resizeStart.current
      if (!s) return
      const w = Math.max(minSize.w, Math.min(window.innerWidth - pos.x - 8, s.w + (e.clientX - s.x)))
      const h = Math.max(minSize.h, Math.min(window.innerHeight - pos.y - 8, s.h + (e.clientY - s.y)))
      setSize({ w, h })
    },
    [minSize, pos],
  )
  const onResizeUp = useCallback((e: React.PointerEvent) => {
    resizeStart.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  }, [])

  const windowBox = (
    <Box
      position="absolute"
      left={`${pos.x}px`}
      top={`${pos.y}px`}
      w={`${size.w}px`}
      h={`${size.h}px`}
      maxW="calc(100vw - 16px)"
      maxH="calc(100vh - 16px)"
      bg="panel.bg"
      borderWidth="1px"
      borderColor="panel.border"
      borderRadius="lg"
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
        // Stop the browser from claiming the touch gesture as a scroll/pan
        // (which fires pointercancel and kills the drag on touch devices).
        touchAction="none"
        {...handlers}
      >
        {icon && <Icon as={icon} color="brand.fg" boxSize="4" />}
        <Text fontWeight="bold" fontSize="sm" flex="1" truncate>
          {title}
        </Text>
        <IconButton aria-label={t("assets.close")} size="xs" variant="ghost" onClick={onClose}>
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
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          css={{
            background:
              "linear-gradient(135deg, transparent 50%, var(--chakra-colors-panel-border) 50%, var(--chakra-colors-panel-border) 62%, transparent 62%, transparent 74%, var(--chakra-colors-panel-border) 74%, var(--chakra-colors-panel-border) 86%, transparent 86%)",
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
