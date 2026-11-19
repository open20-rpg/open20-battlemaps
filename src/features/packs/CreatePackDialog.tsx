import { useState } from "react"
import { Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { Modal } from "../../ui/Modal"
import { toaster } from "../../ui/chakra/toaster-instance"
import { withLoading } from "../../stores/loadingStore"
import { usePacksStore } from "../../stores/packsStore"
import { createUserPack, type PackMeta } from "./api"
import { PackMetaForm } from "./PackMetaForm"

/** Name a new, empty pack of your own; it opens in the pack editor. */
export function CreatePackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const create = async (meta: PackMeta) => {
    setBusy(true)
    try {
      const pack = await withLoading(t("loading.creatingPack"), () => createUserPack(meta))
      const store = usePacksStore.getState()
      store.addOrUpdate([pack])
      onClose()
      store.openEditor(pack.id)
    } catch (e) {
      toaster.create({ type: "error", title: t("userPacks.createError"), description: String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={t("userPacks.createTitle")} size="sm">
      {open && (
        <VStack align="stretch" gap="3">
          <Text fontSize="sm" color="fg.muted">
            {t("userPacks.createIntro")}
          </Text>
          <PackMetaForm
            submitLabel={t("userPacks.create")}
            busy={busy}
            autoFocus
            onSubmit={(m) => void create(m)}
          />
        </VStack>
      )}
    </Modal>
  )
}
