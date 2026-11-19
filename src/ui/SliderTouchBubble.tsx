import { Box, Portal, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { type FineSliderTouch } from "./useFineSlider"

/** Px above the finger the bubble floats (the finger covers the slider). */
const ABOVE_PX = 64

/** A slider's value over the finger dragging it, and whether it's in the precise mode. */
export function SliderTouchBubble({ touch, label }: { touch: FineSliderTouch; label: string }) {
  const { t } = useTranslation()
  return (
    <Portal>
      <Box
        position="fixed"
        left={`${touch.x}px`}
        top={`${touch.y - ABOVE_PX}px`}
        transform="translate(-50%, -100%)"
        zIndex="tooltip"
        pointerEvents="none"
        px="2.5"
        py="1"
        borderRadius="md"
        borderWidth="1px"
        borderColor={touch.fine ? "brand.solid" : "panel.border"}
        bg="panel.solid"
        boxShadow="lg"
        textAlign="center"
      >
        <Text fontSize="md" fontWeight="semibold" fontVariantNumeric="tabular-nums">
          {label}
        </Text>
        {touch.fine && (
          <Text fontSize="2xs" color="brand.fg">
            {t("tools.sliderFine")}
          </Text>
        )}
      </Box>
    </Portal>
  )
}
