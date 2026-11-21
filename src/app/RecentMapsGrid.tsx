import { useState } from "react"
import { Box, SimpleGrid, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { type RecentMap } from "../stores/settingsStore"
import { mapFileName } from "../lib/mapName"
import { relativeTime } from "../features/backups/time"
import { Thumbnail } from "../ui/Thumbnail"

/** Recent maps as pictures (start screen): click one to open it. */
export function RecentMapsGrid({
  maps,
  columns,
  onOpen,
}: {
  maps: RecentMap[]
  columns: number
  onOpen: (path: string) => void
}) {
  const { i18n } = useTranslation()
  // Times read from one clock for the whole grid.
  const [now] = useState(() => Date.now())
  return (
    <SimpleGrid columns={columns} gap="3">
      {maps.map((m) => (
        <Box
          key={m.path}
          as="button"
          textAlign="left"
          borderRadius="lg"
          borderWidth="1px"
          borderColor="panel.border"
          bg="panel.solid"
          overflow="hidden"
          title={m.path}
          _hover={{ borderColor: "brand.solid" }}
          onClick={() => onOpen(m.path)}
        >
          <Thumbnail src={m.thumbnail} w="full" aspectRatio={4 / 3} borderRadius="0" />
          <Box px="2" py="1.5">
            <Text fontSize="sm" color="fg" fontWeight="medium" truncate>
              {mapFileName(m.path)}
            </Text>
            {m.usedAt !== undefined && (
              <Text fontSize="2xs" color="fg.muted" truncate>
                {relativeTime(m.usedAt, now, i18n.language)}
              </Text>
            )}
          </Box>
        </Box>
      ))}
    </SimpleGrid>
  )
}
