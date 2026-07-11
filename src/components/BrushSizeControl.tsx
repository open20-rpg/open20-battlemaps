import { Box, Flex, Slider, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useTools } from "../context/tools"

interface BrushSizeControlProps {
  toolId: string
  min: number
  max: number
  step: number
  defaultValue: number
}

/**
 * Brush size control: a draggable slider whose range (min/max/step) and default
 * vary per tool. The value is stored as a number in the tool's params, falling
 * back to `defaultValue` until the user changes it. It is always visible and
 * never null — tools that want a free-paint mode expose it as a `brush` shape.
 */
export function BrushSizeControl({ toolId, min, max, step, defaultValue }: BrushSizeControlProps) {
  const { t } = useTranslation()
  const { getToolParams, setToolParams } = useTools()
  const stored = getToolParams(toolId).brushSize as number | undefined
  const current = stored ?? defaultValue

  return (
    <Box px="3" py="1.5">
      <Flex mb="2" align="center" justify="space-between">
        <Text fontSize="xs" color="fg.muted">
          {t("tools.brushSize")}
        </Text>
        <Text fontSize="xs" color="fg" fontVariantNumeric="tabular-nums">
          {current}
        </Text>
      </Flex>
      <Slider.Root
        size="sm"
        min={min}
        max={max}
        step={step}
        value={[current]}
        onValueChange={(e) => setToolParams(toolId, { brushSize: e.value[0] })}
      >
        <Slider.Control>
          <Slider.Track>
            <Slider.Range />
          </Slider.Track>
          <Slider.Thumb index={0}>
            <Slider.HiddenInput />
          </Slider.Thumb>
        </Slider.Control>
      </Slider.Root>
    </Box>
  )
}
