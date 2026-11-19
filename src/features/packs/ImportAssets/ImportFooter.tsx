import { Box, Button, Flex, HStack, Progress, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { Select } from "../../../ui/Select"
import { type ImportQuality } from "../api"

/** Optimization choice, what's still pending, progress, and the import button. */
export function ImportFooter({
  quality,
  onQuality,
  progress,
  pending,
  unreadable,
  count,
  busy,
  canImport,
  onCancel,
  onImport,
}: {
  quality: ImportQuality
  onQuality: (q: ImportQuality) => void
  progress: { index: number; total: number } | null
  /** Images still being read. */
  pending: number
  unreadable: number
  /** Items that will be imported. */
  count: number
  busy: boolean
  canImport: boolean
  onCancel: () => void
  onImport: () => void
}) {
  const { t } = useTranslation()
  const status =
    pending > 0
      ? t("userPacks.preparing", { count: pending })
      : unreadable > 0
        ? t("userPacks.skipUnreadable", { count: unreadable })
        : ""
  return (
    <Flex
      px="3"
      py="2.5"
      gap="2"
      align="center"
      borderTopWidth="1px"
      borderColor="panel.border"
      bg="panel.header"
      flexWrap="wrap"
      flexShrink={0}
    >
      <HStack gap="2" flex="1" minW="200px">
        <Text fontSize="xs" color="fg.muted" flexShrink={0}>
          {t("userPacks.optimize")}
        </Text>
        <Box w="190px">
          <Select
            size="xs"
            value={quality}
            items={[
              { value: "balanced", label: t("userPacks.qualityBalanced") },
              { value: "lossless", label: t("userPacks.qualityLossless") },
            ]}
            onChange={(v) => onQuality(v as ImportQuality)}
          />
        </Box>
      </HStack>
      {progress ? (
        <Box flex="1" minW="160px">
          <Text fontSize="2xs" color="fg.muted" mb="1">
            {t("userPacks.importingProgress", progress)}
          </Text>
          <Progress.Root
            value={(progress.index / progress.total) * 100}
            size="xs"
            colorPalette="brand"
          >
            <Progress.Track>
              <Progress.Range />
            </Progress.Track>
          </Progress.Root>
        </Box>
      ) : (
        <Text fontSize="xs" color="fg.muted">
          {status}
        </Text>
      )}
      <HStack gap="2" ml="auto">
        <Button size="sm" variant="subtle" onClick={onCancel} disabled={busy}>
          {t("userPacks.cancel")}
        </Button>
        <Button
          size="sm"
          colorPalette="brand"
          onClick={onImport}
          disabled={!canImport}
          loading={busy}
        >
          {t("userPacks.importN", { count })}
        </Button>
      </HStack>
    </Flex>
  )
}
