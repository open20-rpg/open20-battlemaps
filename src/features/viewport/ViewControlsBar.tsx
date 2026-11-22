import { useState } from "react"
import { Box, Flex, Icon, Menu, Portal, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useActionBinding, withBinding } from "../shortcuts/bindings"
import { Tooltip } from "../../ui/chakra/tooltip"
import { useViewStore } from "../../stores/viewStore"
import { VIEW_CONTROLS, ZOOM_LEVELS, type ToggleControl, type ZoomControl } from "./controls"
import { ExtensionToggles } from "../extensions/ui/ExtensionToggles"

/** Shared square hit-target size for the bottom controls (matches ToolIcon). */
const BOX = "38px"

/** An on/off view toggle (Grid, Snap, Lighting). Active = the overlay is on. */
function ToggleButton({ control }: { control: ToggleControl }) {
  const { t } = useTranslation()
  const active = useViewStore((s) => s[control.key])
  const toggle = useViewStore((s) => s.toggle)
  const label = t(control.nameKey)
  const binding = useActionBinding(control.key)

  return (
    <Tooltip
      content={withBinding(label, binding)}
      positioning={{ placement: "right" }}
      openDelay={200}
      showArrow
    >
      <Flex
        as="button"
        align="center"
        justify="center"
        boxSize={BOX}
        borderRadius="md"
        flexShrink={0}
        color={active ? "brand.fg" : "menubar.fg"}
        bg={active ? "panel.rowSelected" : "transparent"}
        _hover={{ bg: active ? "panel.rowSelected" : "panel.rowHover" }}
        onClick={() => toggle(control.key)}
        aria-label={label}
        aria-pressed={active}
      >
        <Icon as={control.icon} boxSize="5" />
      </Flex>
    </Tooltip>
  )
}

/** Zoom selector: shows the current zoom % and opens the level menu on click. */
function ZoomSelector({ control }: { control: ZoomControl }) {
  const { t } = useTranslation()
  const zoom = useViewStore((s) => s.zoom)
  const setZoom = useViewStore((s) => s.setZoom)
  const label = t(control.nameKey)
  // The tooltip and the menu both open to the right of the trigger, so they'd
  // overlap. Track hover + menu-open and suppress the tooltip while the menu
  // is open (controlled `open` keeps the wrapper mounted, so the menu stays up).
  const [hovering, setHovering] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // Largest zoom on top, smallest at the bottom (800% first, 10% last).
  const levels = [...ZOOM_LEVELS].reverse()

  return (
    // The Tooltip anchors to this wrapper Box, NOT to the Menu.Trigger. Sharing
    // one node between a tooltip trigger and a menu trigger (both `asChild`)
    // clobbers the menu's positioning reference and pins the menu to (0,0), so
    // the two triggers must live on separate DOM nodes.
    <Tooltip
      content={label}
      positioning={{ placement: "right" }}
      openDelay={200}
      showArrow
      open={hovering && !menuOpen}
      onOpenChange={(e) => setHovering(e.open)}
    >
      <Box flexShrink={0}>
        <Menu.Root
          positioning={{ placement: "right-end" }}
          onOpenChange={(e) => setMenuOpen(e.open)}
        >
          <Menu.Trigger
            display="flex"
            flexDirection="column"
            alignItems="center"
            gap="0.5"
            w={BOX}
            py="1"
            borderRadius="md"
            color="menubar.fg"
            bg="transparent"
            _hover={{ bg: "panel.rowHover" }}
            _open={{ bg: "panel.rowSelected", color: "brand.fg" }}
            aria-label={label}
          >
            <Icon as={control.icon} boxSize="4" />
            <Text fontSize="2xs" fontWeight="medium" lineHeight="1">
              {zoom}%
            </Text>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content
                bg="panel.solid"
                borderColor="panel.border"
                minW="20"
                maxH="60vh"
                overflowY="auto"
              >
                {levels.map((level) => {
                  const selected = level === zoom
                  return (
                    <Menu.Item
                      key={level}
                      value={String(level)}
                      onClick={() => setZoom(level)}
                      color={selected ? "brand.fg" : undefined}
                      fontWeight={selected ? "bold" : undefined}
                      // Scroll the current level into view when the menu opens.
                      ref={selected ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}
                    >
                      {level}%
                    </Menu.Item>
                  )
                })}
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      </Box>
    </Tooltip>
  )
}

/**
 * The bottom-anchored bar of view controls, rendered as the footer of the
 * left tool bar. Widgets come from the data-driven VIEW_CONTROLS list.
 */
export function ViewControlsBar() {
  return (
    <VStack
      gap="1"
      py="2"
      flexShrink={0}
      align="center"
      borderTopWidth="1px"
      borderColor="panel.border"
    >
      {VIEW_CONTROLS.map((control) =>
        control.kind === "toggle" ? (
          <ToggleButton key={control.id} control={control} />
        ) : control.kind === "extensions" ? (
          <ExtensionToggles key={control.id} />
        ) : (
          <ZoomSelector key={control.id} control={control} />
        ),
      )}
    </VStack>
  )
}
