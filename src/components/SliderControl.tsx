import { Box, Flex, Slider, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useTools } from "../context/tools"

/**
 * Plain numeric slider param (e.g. Rotation). The value is stored in the tool's
 * params, falling back to `defaultValue` until the user drags.
 */
export function SliderControl({
  toolId,
  paramKey,
  labelKey,
  min,
  max,
  step,
  defaultValue,
}: {
  toolId: string
  paramKey: string
  labelKey: string
  min: number
  max: number
  step: number
  defaultValue: number
}) {
  const { t } = useTranslation()
  const { getToolParams, setToolParams } = useTools()
  const current = (getToolParams(toolId)[paramKey] as number | undefined) ?? defaultValue

  return (
    <Box px="3" py="1.5">
      <Flex mb="2" align="center" justify="space-between">
        <Text fontSize="xs" color="fg.muted">
          {t(labelKey)}
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
        onValueChange={(e) => setToolParams(toolId, { [paramKey]: e.value[0] })}
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
