import { Button, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { Modal } from "../../ui/Modal"

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
      <Stack gap="2" color="fg.muted" fontSize="sm">
        <Text color="fg" fontWeight="semibold">
          {t("about.version", { version: __APP_VERSION__ })}
        </Text>
        <Text>{t("about.desc")}</Text>
        <Text>{t("about.compat")}</Text>
      </Stack>
    </Modal>
  )
}
