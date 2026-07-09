import { useCallback, useRef, useState, type ReactNode } from "react"
import { Box, Flex, Icon, IconButton, Text } from "@chakra-ui/react"
import type { IconType } from "react-icons"
import { LuX } from "react-icons/lu"

// Shared z-index counter so the last window a user interacts with comes forward.
let zCounter = 100

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
  width?: string
  height?: string
  /** Optional toolbar rendered under the title bar. */
  toolbar?: ReactNode
  /** When true, render a backdrop that blocks interaction with the rest of the app. */
  modal?: boolean
  /** Close the window when the modal backdrop is clicked (default true). */
  closeOnBackdropClick?: boolean
  children: ReactNode
}

/**
 * A draggable, self-contained floating panel with a title bar and close button.
 * Reused for every tool window in the app (assets, layers, properties, ...).
 * Content is laid out as a column: [title bar] [optional toolbar] [scrolling body].
 */
export function FloatingWindow({
  title,
  icon,
  onClose,
  initialPosition = { x: 120, y: 90 },
  width = "520px",
  height = "560px",
  toolbar,
  modal = false,
  closeOnBackdropClick = true,
  children,
}: FloatingWindowProps) {
  const { pos, handlers } = useDrag(initialPosition)
  const [z, setZ] = useState(() => ++zCounter)
  const bringToFront = () => setZ(++zCounter)

  return (
    <>
      {modal && (
        <Box
          position="fixed"
          inset="0"
          bg="blackAlpha.600"
          zIndex={z}
          onPointerDown={closeOnBackdropClick ? onClose : undefined}
        />
      )}
      <Box
        position="absolute"
        left={`${pos.x}px`}
        top={`${pos.y}px`}
      w={width}
      maxW="calc(100vw - 24px)"
      h={height}
      maxH="calc(100vh - 80px)"
      bg="panel.bg"
      borderWidth="1px"
      borderColor="panel.border"
      borderRadius="lg"
      boxShadow="0 12px 40px rgba(0,0,0,0.55)"
      display="flex"
      flexDirection="column"
      overflow="hidden"
      zIndex={modal ? z + 1 : z}
      onPointerDownCapture={bringToFront}
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
        {...handlers}
      >
        {icon && <Icon as={icon} color="brand.fg" boxSize="4" />}
        <Text fontWeight="bold" fontSize="sm" flex="1" truncate>
          {title}
        </Text>
        <IconButton aria-label="Cerrar" size="xs" variant="ghost" onClick={onClose}>
          <LuX />
        </IconButton>
      </Flex>

      {toolbar}

      <Box flex="1" minH="0" display="flex" flexDirection="column" overflow="hidden">
        {children}
      </Box>
      </Box>
    </>
  )
}
