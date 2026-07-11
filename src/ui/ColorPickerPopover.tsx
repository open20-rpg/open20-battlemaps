import { useState, type ReactNode } from "react"
import { Box, Button, ColorPicker, Portal, parseColor } from "@chakra-ui/react"

/**
 * A cross-platform color picker (Chakra ColorPicker) with an alpha channel,
 * opened from an arbitrary trigger. It stays open while picking — committing the
 * chosen color (as #RRGGBBAA) each time an adjustment ends — and only closes on
 * an outside click / Escape. When `onAdd` is given, an explicit action button is
 * shown inside the picker (used to add the current color as a preset).
 */
export function ColorPickerPopover({
  value,
  onCommit,
  onAdd,
  addLabel,
  children,
}: {
  value: string
  /** Called each time an adjustment ends (live), while the picker stays open. */
  onCommit?: (hex8: string) => void
  /** If set, render an action button; clicking it passes the current color. */
  onAdd?: (hex8: string) => void
  addLabel?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [color, setColor] = useState(() => parseColor(value))

  return (
    <ColorPicker.Root
      open={open}
      onOpenChange={(e) => {
        if (e.open) setColor(parseColor(value)) // reseed from the live value
        setOpen(e.open)
      }}
      value={color}
      onValueChange={(e) => setColor(e.value)}
      onValueChangeEnd={(e) => onCommit?.(e.value.toString("hexa"))}
      format="rgba"
      closeOnSelect={false}
      positioning={{ placement: "bottom-start" }}
    >
      <ColorPicker.HiddenInput />
      <ColorPicker.Trigger asChild>{children}</ColorPicker.Trigger>
      <Portal>
        <ColorPicker.Positioner>
          <ColorPicker.Content
            bg="panel.solid"
            borderColor="panel.border"
            borderWidth="1px"
            p="4"
            gap="4"
            minW="min(280px, calc(100vw - 24px))"
          >
            <ColorPicker.Area h="180px">
              <ColorPicker.AreaBackground />
              <ColorPicker.AreaThumb boxSize="18px" />
            </ColorPicker.Area>
            <ColorPicker.ChannelSlider channel="hue" h="22px">
              <ColorPicker.ChannelSliderTrack h="full" borderRadius="full">
                <ColorPicker.ChannelSliderThumb boxSize="22px" />
              </ColorPicker.ChannelSliderTrack>
            </ColorPicker.ChannelSlider>
            <ColorPicker.ChannelSlider channel="alpha" h="22px">
              <Box
                position="absolute"
                inset="0"
                borderRadius="full"
                css={{
                  backgroundImage:
                    "conic-gradient(#0000 90deg, #7a7a7a 90deg 180deg, #0000 180deg 270deg, #7a7a7a 270deg)",
                  backgroundSize: "12px 12px",
                }}
              />
              <ColorPicker.ChannelSliderTrack h="full" borderRadius="full">
                <ColorPicker.ChannelSliderThumb boxSize="22px" />
              </ColorPicker.ChannelSliderTrack>
            </ColorPicker.ChannelSlider>
            <ColorPicker.ChannelInput channel="hex" px="2.5" h="9" borderRadius="md" />
            {onAdd && (
              <Button
                size="md"
                colorPalette="blue"
                onClick={() => {
                  onAdd(color.toString("hexa"))
                  setOpen(false)
                }}
              >
                {addLabel}
              </Button>
            )}
          </ColorPicker.Content>
        </ColorPicker.Positioner>
      </Portal>
    </ColorPicker.Root>
  )
}
