import { Box, Input, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"

/** A one-line text param (extensions' tools and properties). */
export function TextParamControl({
  value,
  labelKey,
  maxLength,
  onChange,
}: {
  value: string
  labelKey: string
  maxLength?: number
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Box px="3" py="1.5">
      <Text fontSize="xs" color="fg.muted" mb="1">
        {t(labelKey)}
      </Text>
      <Input
        size="xs"
        value={value}
        maxLength={maxLength ?? 500}
        aria-label={t(labelKey)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Box>
  )
}
