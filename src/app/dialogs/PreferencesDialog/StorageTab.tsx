import { Suspense, startTransition, use, useEffect, useState } from "react"
import { Box, Button, Flex, HStack, Stack, Text } from "@chakra-ui/react"
import { confirm } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import i18n from "../../../i18n"
import { withLoading } from "../../../stores/loadingStore"
import { usePacksStore } from "../../../stores/packsStore"
import { uninstallPacks } from "../../../features/packs/uninstall"
import { clearStorage, storageUsage, type ClearableStorage } from "../../../features/storage/api"
import { formatBytes } from "../../../lib/bytes"

/**
 * Settings › Storage: what the app keeps on disk, in its own terms (each
 * installed pack, the Library's thumbnails, downloaded fonts, the rest) and
 * the space each takes. Only what the app can bring back is cleared here;
 * packs are uninstalled (as in the Assets manager).
 */
const loadUsage = () => withLoading(i18n.t("storage.measuring"), () => storageUsage())

export function StorageTab() {
  const { t } = useTranslation()
  return (
    <Suspense
      fallback={
        <Text fontSize="sm" color="fg.muted">
          {t("storage.measuring")}
        </Text>
      }
    >
      <StorageView />
    </Suspense>
  )
}

function StorageView() {
  const { t, i18n: lang } = useTranslation()
  const packs = usePacksStore((s) => s.packs)
  const ensurePacks = usePacksStore((s) => s.ensureLoaded)
  // Measured when the tab opens, again after each change (or Refresh).
  const [request, setRequest] = useState(loadUsage)
  const usage = use(request)
  const [busy, setBusy] = useState(false)
  const size = (bytes: number) => formatBytes(bytes, lang.language)

  // Pack names come from the installed list.
  useEffect(() => ensurePacks(), [ensurePacks])

  // Keep showing the last measure while the new one comes.
  const remeasure = () => startTransition(() => setRequest(loadUsage()))

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      remeasure()
    } finally {
      setBusy(false)
    }
  }

  const clear = (kind: ClearableStorage) =>
    run(async () => {
      const ok = await confirm(t(`storage.clear.${kind}.confirm`), {
        title: t(`storage.clear.${kind}.title`),
        kind: "warning",
      })
      if (ok) await withLoading(t("storage.clearing"), () => clearStorage(kind))
    })

  const nameOf = (id: string) => packs.find((p) => p.id === id)?.name ?? id
  const packBytes = usage.packs.reduce((sum, p) => sum + p.bytes, 0)
  const thumbBytes = usage.packs.reduce((sum, p) => sum + p.thumbnailBytes, 0)

  return (
    <Stack gap="4" fontSize="sm">
      <Text color="fg.muted">{t("storage.intro")}</Text>
      <HStack justify="space-between">
        <Text fontWeight="semibold">{t("storage.total", { size: size(usage.totalBytes) })}</Text>
        <Button size="xs" variant="outline" disabled={busy} onClick={remeasure}>
          {t("storage.refresh")}
        </Button>
      </HStack>

      <Item
        title={t("storage.packs")}
        size={size(packBytes)}
        hint={t("storage.packsHint", { count: usage.packs.length })}
      >
        {usage.packs.length > 0 && (
          <Stack gap="1" mt="2">
            {usage.packs.map((p) => (
              <Flex key={p.id} align="center" gap="2" justify="space-between">
                <Text truncate>{nameOf(p.id)}</Text>
                <HStack gap="2" flexShrink={0}>
                  <Text color="fg.muted">{size(p.bytes)}</Text>
                  <Button
                    size="2xs"
                    variant="ghost"
                    colorPalette="brand"
                    disabled={busy}
                    onClick={() => void run(() => uninstallPacks([p.id]))}
                  >
                    {t("storage.uninstall")}
                  </Button>
                </HStack>
              </Flex>
            ))}
          </Stack>
        )}
      </Item>

      <Item
        title={t("storage.thumbnails")}
        size={size(thumbBytes)}
        hint={t("storage.thumbnailsHint")}
        action={t("storage.clearAction")}
        disabled={busy || thumbBytes === 0}
        onAction={() => void clear("thumbnails")}
      />

      <Item
        title={t("storage.fonts")}
        size={size(usage.fontsBytes)}
        hint={t("storage.fontsHint", { count: usage.fontsCount })}
        action={t("storage.clearAction")}
        disabled={busy || usage.fontsBytes === 0}
        onAction={() => void clear("fonts")}
      />

      <Item
        title={t("storage.other")}
        size={size(usage.otherBytes)}
        hint={t("storage.otherHint")}
      />
    </Stack>
  )
}

/** One kind of data: its name, size, what it is and (when it can be) its action. */
function Item({
  title,
  size,
  hint,
  action,
  disabled,
  onAction,
  children,
}: {
  title: string
  size: string
  hint: string
  action?: string
  disabled?: boolean
  onAction?: () => void
  children?: React.ReactNode
}) {
  return (
    <Box borderWidth="1px" borderColor="panel.border" borderRadius="md" p="3">
      <Flex align="center" gap="3" justify="space-between">
        <Box minW="0">
          <HStack gap="2">
            <Text fontWeight="semibold">{title}</Text>
            <Text color="fg.muted">{size}</Text>
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            {hint}
          </Text>
        </Box>
        {action && (
          <Button size="xs" variant="outline" disabled={disabled} onClick={onAction}>
            {action}
          </Button>
        )}
      </Flex>
      {children}
    </Box>
  )
}
