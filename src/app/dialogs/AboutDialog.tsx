import { Button, HStack, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { Modal } from "../../ui/Modal"
import { BrandMark } from "../BrandMark"

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("about.title")}
      footer={
        <Button variant="subtle" onClick={onClose}>
          {t("prefs.close")}
        </Button>
      }
    >
      <Stack gap="3" color="fg.muted" fontSize="sm">
        <HStack gap="3">
          <BrandMark variant="battleMaps" boxSize="12" color="fg" flexShrink={0} />
          <Text color="fg" fontWeight="semibold">
            {t("about.version", { version: __APP_VERSION__ })}
          </Text>
        </HStack>
        <Text>{t("about.desc")}</Text>
        <HStack gap="2" color="fg.subtle">
          <BrandMark variant="suite" boxSize="5" color="fg.muted" />
          <Text>{t("about.suite")}</Text>
        </HStack>
        <Text>{t("about.compat")}</Text>
      </Stack>
    </Modal>
  )
}
