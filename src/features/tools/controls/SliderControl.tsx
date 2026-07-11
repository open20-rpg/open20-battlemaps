import { Box, Flex, Slider, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"

/**
 * Plain numeric slider param (e.g. Rotation, Brush Size). Label and range come
 * from the param spec.
 */
export function SliderControl({
  value,
  labelKey,
  min,
  max,
  step,
  onChange,
}: {
  value: number
  labelKey: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()

  return (
    <Box px="3" py="1.5">
      <Flex mb="2" align="center" justify="space-between">
        <Text fontSize="xs" color="fg.muted">
          {t(labelKey)}
        </Text>
        <Text fontSize="xs" color="fg" fontVariantNumeric="tabular-nums">
          {value}
        </Text>
      </Flex>
      <Slider.Root
        size="sm"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(e) => onChange(e.value[0])}
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
