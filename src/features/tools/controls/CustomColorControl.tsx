import { useState } from "react"
import { Box, Flex, IconButton, Popover, Portal, Text } from "@chakra-ui/react"
import { LuChevronDown, LuPipette, LuPlus } from "react-icons/lu"
import { useTranslation } from "react-i18next"
import { ColorPickerPopover } from "../../../ui/ColorPickerPopover"
import { useSettingsStore } from "../../../stores/settingsStore"
import { BUILTIN_COLOR_PRESETS } from "../../../lib/colors"

// Touch-friendly swatch size.
const DOT = "34px"

/**
 * Custom Color parameter for asset tools: a dropdown of preset color swatches
 * (with a "+" that opens the color picker to add a new preset) plus a standalone
 * button that opens the picker for a one-off custom color. The chosen color is
 * stored in the tool's params so the library can read it and recolor assets.
 * Presets are user settings, so they come from the settings store.
 */
export function CustomColorControl({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const userPresets = useSettingsStore((s) => s.colorPresets)
  const addColorPreset = useSettingsStore((s) => s.addColorPreset)
  const [open, setOpen] = useState(false)

  const presets = [...BUILTIN_COLOR_PRESETS, ...userPresets]
  const addPreset = (c: string) => {
    if (!presets.includes(c)) addColorPreset(c)
    onChange(c)
  }

  return (
    <Box px="3" py="1.5">
      <Text mb="2" fontSize="xs" color="fg.muted">
        {t("tools.customColor")}
      </Text>
      <Flex gap="2" align="center">
        <Popover.Root
          open={open}
          onOpenChange={(e) => setOpen(e.open)}
          positioning={{ placement: "bottom-start" }}
        >
          <Popover.Trigger asChild>
            <Flex
              as="button"
              flex="1"
              h={DOT}
              align="center"
              justify="flex-end"
              pr="1.5"
              bg={value}
              borderWidth="1px"
              borderColor="panel.border"
              borderRadius="md"
              cursor="pointer"
              overflow="hidden"
              _hover={{ borderColor: "brand.fg" }}
            >
              <Flex
                align="center"
                justify="center"
                boxSize="22px"
                borderRadius="sm"
                bg="blackAlpha.500"
                color="white"
              >
                <LuChevronDown size={15} />
              </Flex>
            </Flex>
          </Popover.Trigger>
          <Portal>
            <Popover.Positioner>
              <Popover.Content w="auto" bg="panel.solid" borderColor="panel.border">
                <Popover.Body p="3">
                  <Flex wrap="wrap" gap="2" maxW="260px">
                    {presets.map((c) => (
                      <Box
                        as="button"
                        key={c}
                        boxSize={DOT}
                        flexShrink={0}
                        borderRadius="full"
                        bg={c}
                        borderWidth="2px"
                        borderColor={c === value ? "brand.fg" : "transparent"}
                        outline="1px solid"
                        outlineColor="whiteAlpha.300"
                        onClick={() => {
                          onChange(c)
                          setOpen(false)
                        }}
                      />
                    ))}
                    {/* "+" opens the picker; the "Add" button inside it saves the
                        chosen color as a new preset. */}
                    <ColorPickerPopover
                      value={value}
                      onAdd={addPreset}
                      addLabel={t("tools.addColorPreset")}
                    >
                      {/* Mirror the swatch structure exactly so it reads the same
                          size/shape, just with a "+" instead of a color fill. */}
                      <Box
                        as="button"
                        position="relative"
                        boxSize={DOT}
                        minW={DOT}
                        minH={DOT}
                        flexShrink={0}
                        borderRadius="full"
                        color="fg.muted"
                        borderWidth="2px"
                        borderColor="transparent"
                        outline="1px solid"
                        outlineColor="whiteAlpha.300"
                        _hover={{ outlineColor: "brand.fg", color: "brand.fg" }}
                      >
                        <LuPlus
                          size={16}
                          style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                          }}
                        />
                      </Box>
                    </ColorPickerPopover>
                  </Flex>
                </Popover.Body>
              </Popover.Content>
            </Popover.Positioner>
          </Portal>
        </Popover.Root>

        {/* Standalone one-off custom color. */}
        <ColorPickerPopover value={value} onCommit={onChange}>
          <IconButton aria-label={t("tools.pickCustomColor")} size="md" variant="subtle">
            <LuPipette />
          </IconButton>
        </ColorPickerPopover>
      </Flex>
    </Box>
  )
}
