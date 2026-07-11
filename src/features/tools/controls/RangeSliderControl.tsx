import { Box, HStack, NumberInput, Slider, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Two-thumb range control: a numeric end, a dual slider, and the other numeric
 * end. Stores `[low, high]`; the ends never cross (each input is bounded by the
 * other). Used by Scatter's Rotation and Scale spread.
 */
export function RangeSliderControl({
  value,
  labelKey,
  min,
  max,
  step,
  onChange,
}: {
  value: [number, number]
  labelKey: string
  min: number
  max: number
  step: number
  onChange: (value: [number, number]) => void
}) {
  const { t } = useTranslation()
  const [low, high] = value

  const setLow = (v: number) => {
    if (!Number.isNaN(v)) onChange([clamp(v, min, high), high])
  }
  const setHigh = (v: number) => {
    if (!Number.isNaN(v)) onChange([low, clamp(v, low, max)])
  }

  return (
    <Box px="3" py="1.5">
      <Text mb="2" fontSize="xs" color="fg.muted">
        {t(labelKey)}
      </Text>
      <HStack gap="2">
        <NumberInput.Root
          size="xs"
          min={min}
          max={high}
          step={step}
          value={String(low)}
          onValueChange={(e) => setLow(e.valueAsNumber)}
          width="76px"
          flexShrink={0}
        >
          <NumberInput.Input px="1.5" textAlign="center" />
          <NumberInput.Control />
        </NumberInput.Root>

        <Slider.Root
          flex="1"
          size="sm"
          min={min}
          max={max}
          step={step}
          value={[low, high]}
          onValueChange={(e) => onChange([e.value[0], e.value[1]])}
        >
          <Slider.Control>
            <Slider.Track>
              <Slider.Range />
            </Slider.Track>
            <Slider.Thumb index={0}>
              <Slider.HiddenInput />
            </Slider.Thumb>
            <Slider.Thumb index={1}>
              <Slider.HiddenInput />
            </Slider.Thumb>
          </Slider.Control>
        </Slider.Root>

        <NumberInput.Root
          size="xs"
          min={low}
          max={max}
          step={step}
          value={String(high)}
          onValueChange={(e) => setHigh(e.valueAsNumber)}
          width="76px"
          flexShrink={0}
        >
          <NumberInput.Input px="1.5" textAlign="center" />
          <NumberInput.Control />
        </NumberInput.Root>
      </HStack>
    </Box>
  )
}
