import { Button, Flex, IconButton, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuX } from "react-icons/lu"
import { useSettingsStore } from "../../stores/settingsStore"
import { Modal } from "../../ui/Modal"
import { Thumbnail } from "../../ui/Thumbnail"
import { mapFileName } from "../../lib/mapName"

/** Recently opened/saved maps: click one to open it, × to forget it. */
export function RecentMapsDialog({
  open,
  onClose,
  onOpen,
}: {
  open: boolean
  onClose: () => void
  onOpen: (path: string) => void
}) {
  const { t } = useTranslation()
  const recent = useSettingsStore((s) => s.recentMaps)
  const remove = useSettingsStore((s) => s.removeRecentMap)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("recent.title")}
      footer={
        <Button variant="subtle" onClick={onClose}>
          {t("prefs.close")}
        </Button>
      }
    >
      {recent.length === 0 ? (
        <Text color="fg.muted" fontSize="sm">
          {t("toast.noRecent")}
        </Text>
      ) : (
        <Stack gap="1">
          {recent.map(({ path, thumbnail }) => (
            <Flex
              key={path}
              align="center"
              gap="2"
              px="2"
              py="1.5"
              borderRadius="md"
              cursor="pointer"
              _hover={{ bg: "panel.rowHover" }}
              onClick={() => {
                onClose()
                onOpen(path)
              }}
            >
              <Thumbnail src={thumbnail} w="56px" h="40px" />
              <Stack gap="0" flex="1" minW="0">
                <Text fontSize="sm" truncate>
                  {mapFileName(path)}
                </Text>
                <Text fontSize="2xs" color="fg.muted" truncate>
                  {path}
                </Text>
              </Stack>
              <IconButton
                aria-label={t("recent.forget")}
                size="2xs"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(path)
                }}
              >
                <LuX />
              </IconButton>
            </Flex>
          ))}
        </Stack>
      )}
    </Modal>
  )
}
