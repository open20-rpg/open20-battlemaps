import { Box, Flex, Input, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"

/** A typed-in number param, clamped to its bounds (extensions' tools and properties). */
export function NumberParamControl({
  value,
  labelKey,
  min,
  max,
  onChange,
}: {
  value: number
  labelKey: string
  min?: number
  max?: number
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()
  return (
    <Box px="3" py="1.5">
      <Flex align="center" justify="space-between" gap="2">
        <Text fontSize="xs" color="fg.muted">
          {t(labelKey)}
        </Text>
        <Input
          size="xs"
          type="number"
          w="20"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          aria-label={t(labelKey)}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n)) return
            onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)))
          }}
        />
      </Flex>
    </Box>
  )
}
