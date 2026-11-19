import { Box, Flex, Slider, Text } from "@chakra-ui/react"
import { formatStep } from "../../../lib/numbers"
import { useTranslation } from "react-i18next"
import { SliderTouchBubble } from "../../../ui/SliderTouchBubble"
import { useFineSlider } from "../../../ui/useFineSlider"

/**
 * Plain numeric slider param (e.g. Rotation, Brush Size). Label and range come
 * from the param spec. On touch, going up or resting the finger switches to a
 * precise drag (ui/useFineSlider), its value shown over the finger.
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
  const { handlers, touch } = useFineSlider({ min, max, step }, value, onChange)

  return (
    <Box px="3" py="1.5" {...handlers}>
      <Flex mb="2" align="center" justify="space-between">
        <Text fontSize="xs" color="fg.muted">
          {t(labelKey)}
        </Text>
        <Text fontSize="xs" color="fg" fontVariantNumeric="tabular-nums">
          {formatStep(value, step)}
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
      {touch && <SliderTouchBubble touch={touch} label={formatStep(value, step)} />}
    </Box>
  )
}
