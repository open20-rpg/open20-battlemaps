import { useRef, useState } from "react"
import { Box, Flex, IconButton, Popover, Portal, Text } from "@chakra-ui/react"
import { LuChevronDown, LuPipette, LuPlus } from "react-icons/lu"
import { useTranslation } from "react-i18next"
import { useTools } from "../context/tools"
import {
  BUILTIN_COLOR_PRESETS,
  DEFAULT_CUSTOM_COLOR,
  loadUserPresets,
  saveUserPresets,
} from "../lib/colors"

/**
 * Custom Color parameter for asset tools: a dropdown of preset color swatches
 * (with a "+" to add a new preset via the color picker) plus a standalone
 * button that opens the picker for a one-off custom color. The chosen color is
 * stored in the tool's params so the library can read it and recolor assets.
 */
export function CustomColorControl({ toolId }: { toolId: string }) {
  const { t } = useTranslation()
  const { getToolParams, setToolParams } = useTools()
  const color = (getToolParams(toolId).customColor as string) || DEFAULT_CUSTOM_COLOR

  const [userPresets, setUserPresets] = useState<string[]>(loadUserPresets)
  const [open, setOpen] = useState(false)
  const pickRef = useRef<HTMLInputElement>(null)
  const addRef = useRef<HTMLInputElement>(null)

  const presets = [...BUILTIN_COLOR_PRESETS, ...userPresets]
  const setColor = (c: string) => setToolParams(toolId, { customColor: c })
  const addPreset = (c: string) => {
    if (!presets.includes(c)) {
      const next = [...userPresets, c]
      setUserPresets(next)
      saveUserPresets(next)
    }
    setColor(c)
  }

  return (
    <Box px="3" py="2.5">
      <Text mb="1.5" fontSize="xs" color="fg.muted">
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
              align="center"
              gap="2"
              px="2"
              py="1"
              borderWidth="1px"
              borderColor="panel.border"
              borderRadius="md"
              cursor="pointer"
              _hover={{ borderColor: "brand.fg" }}
            >
              <Box
                w="18px"
                h="18px"
                borderRadius="full"
                bg={color}
                outline="1px solid"
                outlineColor="whiteAlpha.400"
              />
              <LuChevronDown size={14} />
            </Flex>
          </Popover.Trigger>
          <Portal>
            <Popover.Positioner>
              <Popover.Content w="auto" bg="panel.solid" borderColor="panel.border">
                <Popover.Body p="2">
                  <Flex wrap="wrap" gap="1.5" maxW="164px">
                    {presets.map((c) => (
                      <Box
                        as="button"
                        key={c}
                        w="20px"
                        h="20px"
                        borderRadius="full"
                        bg={c}
                        borderWidth="2px"
                        borderColor={c === color ? "brand.fg" : "transparent"}
                        outline="1px solid"
                        outlineColor="whiteAlpha.300"
                        onClick={() => {
                          setColor(c)
                          setOpen(false)
                        }}
                      />
                    ))}
                    <Flex
                      as="button"
                      align="center"
                      justify="center"
                      w="20px"
                      h="20px"
                      borderRadius="full"
                      color="fg.muted"
                      borderWidth="1px"
                      borderColor="panel.border"
                      _hover={{ borderColor: "brand.fg", color: "brand.fg" }}
                      onClick={() => addRef.current?.click()}
                    >
                      <LuPlus size={12} />
                    </Flex>
                  </Flex>
                </Popover.Body>
              </Popover.Content>
            </Popover.Positioner>
          </Portal>
        </Popover.Root>

        <IconButton
          aria-label={t("tools.pickCustomColor")}
          size="sm"
          variant="subtle"
          onClick={() => pickRef.current?.click()}
        >
          <LuPipette />
        </IconButton>
      </Flex>

      {/* Hidden native pickers: one sets the current color, one adds a preset. */}
      <input
        ref={pickRef}
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_CUSTOM_COLOR}
        onChange={(e) => setColor(e.currentTarget.value)}
        style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
      />
      <input
        ref={addRef}
        type="color"
        defaultValue={DEFAULT_CUSTOM_COLOR}
        onChange={(e) => addPreset(e.currentTarget.value)}
        style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
      />
    </Box>
  )
}
