import type { ReactNode } from "react"
import { Box, ColorPicker, Portal, parseColor } from "@chakra-ui/react"

/**
 * A cross-platform color picker (Chakra ColorPicker) with an alpha channel,
 * opened from an arbitrary trigger. Commits the chosen color as an 8-digit hex
 * (#RRGGBBAA) when the interaction ends. `key={value}` reseeds the picker from
 * the current value each time it changes so it always opens on the live color.
 */
export function ColorPickerPopover({
  value,
  onCommit,
  children,
}: {
  value: string
  onCommit: (hex8: string) => void
  children: ReactNode
}) {
  return (
    <ColorPicker.Root
      key={value}
      defaultValue={parseColor(value)}
      format="rgba"
      positioning={{ placement: "bottom-start" }}
      onValueChangeEnd={(e) => onCommit(e.value.toString("hexa"))}
    >
      <ColorPicker.HiddenInput />
      <ColorPicker.Control>
        <ColorPicker.Trigger asChild>{children}</ColorPicker.Trigger>
      </ColorPicker.Control>
      <Portal>
        <ColorPicker.Positioner>
          <ColorPicker.Content
            bg="panel.solid"
            borderColor="panel.border"
            borderWidth="1px"
            p="3"
            gap="3"
          >
            <ColorPicker.Area>
              <ColorPicker.AreaBackground />
              <ColorPicker.AreaThumb />
            </ColorPicker.Area>
            <ColorPicker.ChannelSlider channel="hue">
              <ColorPicker.ChannelSliderTrack>
                <ColorPicker.ChannelSliderThumb />
              </ColorPicker.ChannelSliderTrack>
            </ColorPicker.ChannelSlider>
            <ColorPicker.ChannelSlider channel="alpha">
              <Box
                position="absolute"
                inset="0"
                borderRadius="inherit"
                css={{
                  backgroundImage:
                    "conic-gradient(#0000 90deg, #7a7a7a 90deg 180deg, #0000 180deg 270deg, #7a7a7a 270deg)",
                  backgroundSize: "10px 10px",
                }}
              />
              <ColorPicker.ChannelSliderTrack>
                <ColorPicker.ChannelSliderThumb />
              </ColorPicker.ChannelSliderTrack>
            </ColorPicker.ChannelSlider>
            <ColorPicker.ChannelInput channel="hex" />
          </ColorPicker.Content>
        </ColorPicker.Positioner>
      </Portal>
    </ColorPicker.Root>
  )
}
