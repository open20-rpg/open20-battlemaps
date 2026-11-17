import { Box, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { Select } from "../../../ui/Select"
import { MAP_LAYERS } from "../definitions"

/**
 * Layer number as shown in the UI: 3-digit, zero-padded ("000", "100").
 * Positives get a leading space (non-breaking, so it survives) in place of the
 * minus sign, so they line up with the negative layers.
 */
function formatLayer(value: number): string {
  const sign = value < 0 ? "-" : " "
  return sign + String(Math.abs(value)).padStart(3, "0")
}

/**
 * Layer selector for tools that place things on a specific map layer. The full
 * list of layers is always shown; only the tool's `allowed` values are
 * selectable (the rest are disabled).
 */
export function LayerControl({
  value,
  allowed,
  onChange,
}: {
  value: number
  allowed: number[]
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()

  const items = MAP_LAYERS.map((layer) => ({
    value: String(layer.value),
    label: `${formatLayer(layer.value)}: ${t(layer.nameKey)}`,
    disabled: !allowed.includes(layer.value),
  }))

  return (
    <Box px="3" py="1.5">
      <Text mb="2" fontSize="xs" color="fg.muted">
        {t("tools.layer")}
      </Text>
      <Select value={String(value)} items={items} onChange={(next) => onChange(Number(next))} />
    </Box>
  )
}
