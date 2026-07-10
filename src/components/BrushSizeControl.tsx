import { Box, Flex, Icon, Slider, Text } from "@chakra-ui/react"
import { LuCircle } from "react-icons/lu"
import { useTranslation } from "react-i18next"
import { useTools } from "../context/tools"

interface BrushSizeControlProps {
  toolId: string
  /** "slider" = draggable slider; "buttons" = one growing-circle button per step. */
  ui: "slider" | "buttons"
  min: number
  max: number
  step: number
  defaultValue: number | null
}

/**
 * Brush size control. Range (min/max/step) and default vary per tool. The value
 * is stored (as a number, or null for "unset") in the tool's params, falling
 * back to `defaultValue` until the user changes it. Two UIs: a draggable slider
 * (wide ranges) or a row of growing-circle buttons (small discrete ranges).
 */
export function BrushSizeControl(props: BrushSizeControlProps) {
  const { toolId, defaultValue } = props
  const { getToolParams, setToolParams } = useTools()
  const stored = getToolParams(toolId).brushSize as number | null | undefined
  // `null` means "no brush size set" (e.g. the Water Brush uses a shape instead).
  const current: number | null = stored === undefined ? defaultValue : stored
  const setSize = (v: number) => setToolParams(toolId, { brushSize: v })

  return props.ui === "buttons" ? (
    <BrushButtons {...props} current={current} onPick={setSize} />
  ) : (
    <BrushSlider {...props} current={current} onPick={setSize} />
  )
}

interface VariantProps extends BrushSizeControlProps {
  current: number | null
  onPick: (v: number) => void
}

function BrushSlider({ min, max, step, current, onPick }: VariantProps) {
  const { t } = useTranslation()
  return (
    <Box px="3" py="1.5">
      <Flex mb="2" align="center" justify="space-between">
        <Text fontSize="xs" color="fg.muted">
          {t("tools.brushSize")}
        </Text>
        <Text fontSize="xs" color="fg" fontVariantNumeric="tabular-nums">
          {current ?? "—"}
        </Text>
      </Flex>
      <Slider.Root
        size="sm"
        min={min}
        max={max}
        step={step}
        value={[current ?? min]}
        onValueChange={(e) => onPick(e.value[0])}
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

function BrushButtons({ min, max, step, current, onPick }: VariantProps) {
  const { t } = useTranslation()
  // One button per discrete step, from smallest to largest.
  const count = Math.round((max - min) / step) + 1
  const values = Array.from({ length: count }, (_, i) => min + i * step)
  // Circle grows from small to large across the buttons.
  const MIN_DOT = 8
  const MAX_DOT = 22

  return (
    <Box px="3" py="1.5">
      <Flex mb="2" align="center" justify="space-between">
        <Text fontSize="xs" color="fg.muted">
          {t("tools.brushSize")}
        </Text>
        <Text fontSize="xs" color="fg" fontVariantNumeric="tabular-nums">
          {current ?? "—"}
        </Text>
      </Flex>
      <Flex borderWidth="1px" borderColor="panel.border" borderRadius="md" overflow="hidden">
        {values.map((v, i) => {
          const active = current === v
          const dot = MIN_DOT + ((MAX_DOT - MIN_DOT) * i) / Math.max(1, count - 1)
          return (
            <Flex
              as="button"
              key={v}
              flex="1"
              align="center"
              justify="center"
              h="34px"
              borderLeftWidth={i === 0 ? "0" : "1px"}
              borderColor="panel.border"
              color={active ? "brand.fg" : "menubar.fg"}
              bg={active ? "panel.rowSelected" : "transparent"}
              _hover={{ bg: active ? "panel.rowSelected" : "panel.rowHover" }}
              onClick={() => onPick(v)}
              aria-label={String(v)}
              aria-pressed={active}
            >
              <Icon as={LuCircle} boxSize={`${dot}px`} fill="currentColor" />
            </Flex>
          )
        })}
      </Flex>
    </Box>
  )
}
