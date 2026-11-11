import { useEffect, useEffectEvent, type ReactNode } from "react"
import { Box, Flex, Heading, IconButton, Portal } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuX } from "react-icons/lu"
import { useModalLayer } from "../stores/modalStackStore"

interface ModalLayerProps {
  open: boolean
  onClose: () => void
  closeOnBackdrop?: boolean
  /** Center the child (dialogs) vs. let it position itself (floating windows). */
  centered?: boolean
  children: ReactNode
}

/**
 * A single stacked modal layer: a full-screen fixed container with one backdrop.
 * Only the topmost open layer is displayed; the rest stay mounted but hidden
 * (`display: none`) so their state is preserved and no extra backdrops pile up.
 * All layers share the same z-index — order is decided by the stack, not z.
 */
export function ModalLayer({
  open,
  onClose,
  closeOnBackdrop = true,
  centered = true,
  children,
}: ModalLayerProps) {
  const { active } = useModalLayer(open)

  // Escape closes only the top (active) layer. `onClose` is read through an
  // effect event so a new callback identity doesn't re-subscribe the listener.
  const requestClose = useEffectEvent(() => onClose())
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active])

  if (!open) return null

  return (
    <Portal>
      <Box position="fixed" inset="0" zIndex="modal" display={active ? "block" : "none"}>
        <Box
          position="absolute"
          inset="0"
          bg="blackAlpha.700"
          onPointerDown={closeOnBackdrop ? onClose : undefined}
        />
        {centered ? (
          <Flex
            position="absolute"
            inset="0"
            align="center"
            justify="center"
            p="4"
            pointerEvents="none"
          >
            <Box pointerEvents="auto" maxH="100%" display="flex">
              {children}
            </Box>
          </Flex>
        ) : (
          children
        )}
      </Box>
    </Portal>
  )
}

const SIZE_WIDTH: Record<string, string> = {
  xs: "320px",
  sm: "400px",
  md: "480px",
  lg: "560px",
}

interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: keyof typeof SIZE_WIDTH
  closeOnBackdrop?: boolean
}

/** A centered dialog built on {@link ModalLayer}, styled like the app panels. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
}: ModalProps) {
  const { t } = useTranslation()
  return (
    <ModalLayer open={open} onClose={onClose} closeOnBackdrop={closeOnBackdrop} centered>
      <Box
        bg="panel.bg"
        borderWidth="1px"
        borderColor="panel.border"
        borderRadius="lg"
        w={SIZE_WIDTH[size]}
        maxW="calc(100vw - 32px)"
        // Tall content scrolls inside the body; header and footer stay put.
        maxH="calc(100vh - 32px)"
        display="flex"
        flexDirection="column"
        overflow="hidden"
      >
        <Flex
          align="center"
          gap="3"
          px="5"
          py="3"
          borderBottomWidth="1px"
          borderColor="panel.border"
          flexShrink={0}
        >
          <Heading size="md" flex="1">
            {title}
          </Heading>
          <IconButton aria-label={t("assets.close")} size="xs" variant="ghost" onClick={onClose}>
            <LuX />
          </IconButton>
        </Flex>
        <Box px="5" py="4" overflowY="auto" flex="1" minH="0">
          {children}
        </Box>
        {footer && (
          <Flex
            px="5"
            py="3"
            gap="3"
            justify="flex-end"
            borderTopWidth="1px"
            borderColor="panel.border"
            flexShrink={0}
          >
            {footer}
          </Flex>
        )}
      </Box>
    </ModalLayer>
  )
}
