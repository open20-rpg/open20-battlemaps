import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge, Box, Button, Flex, HStack, IconButton } from "@chakra-ui/react"
import { confirm } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import {
  LuCircleOff,
  LuCirclePlay,
  LuFolderOpen,
  LuGem,
  LuPackagePlus,
  LuRefreshCw,
  LuTrash2,
} from "react-icons/lu"
import { FloatingWindow } from "../../../ui/FloatingWindow"
import { withLoading } from "../../../stores/loadingStore"
import { usePacksStore } from "../../../stores/packsStore"
import { useHasMap } from "../../../stores/mapStore"
import { openPacksDir, setPackEnabled, uninstallPack } from "../api"
import { isPackUsed, clearPackReferences } from "../../map/packUsage"
import { PackList } from "./PackList"
import { PackPreview } from "./PackPreview"
import { useInstallFlow } from "./useInstallFlow"

// -- the manager window --------------------------------------------------------

export function AssetsManager({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const packs = usePacksStore((s) => s.packs)
  const loading = usePacksStore((s) => s.loading)
  const ensureLoaded = usePacksStore((s) => s.ensureLoaded)
  const refresh = usePacksStore((s) => s.refresh)
  const addOrUpdate = usePacksStore((s) => s.addOrUpdate)
  const applyEnabled = usePacksStore((s) => s.applyEnabled)
  const removePacks = usePacksStore((s) => s.removePacks)
  const hasMap = useHasMap()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)

  const { installing, progress, install } = useInstallFlow(addOrUpdate)
  const busy = installing || mutating

  useEffect(() => {
    // Load lazily on first open; reopening reuses the cached list.
    ensureLoaded()
  }, [ensureLoaded])

  // Prune selection/focus when the cached list changes (e.g. after a delete).
  // Done during render (previous-value pattern) instead of in an effect.
  const [prevPacks, setPrevPacks] = useState(packs)
  if (packs !== prevPacks) {
    setPrevPacks(packs)
    setSelected((prev) => new Set([...prev].filter((id) => packs.some((p) => p.id === id))))
    setFocusedId((prev) => (prev && packs.some((p) => p.id === prev) ? prev : null))
  }

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const focusedPack = useMemo(
    () => packs.find((p) => p.id === focusedId) ?? null,
    [packs, focusedId],
  )

  const allSelected = packs.length > 0 && selected.size === packs.length
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(packs.map((p) => p.id)))

  const setEnabledForSelected = async (enabled: boolean) => {
    const ids = [...selected]
    if (ids.length === 0) return

    // Deactivating a pack the open map depends on deletes the configs that
    // reference it, and that reset isn't tracked by undo/redo — confirm first.
    const usedIds = enabled ? [] : ids.filter((id) => isPackUsed(id))
    if (usedIds.length > 0) {
      const ok = await confirm(t("assets.deactivateUsedConfirm", { count: usedIds.length }), {
        title: t("assets.deactivateUsedTitle"),
        kind: "warning",
      })
      if (!ok) return
    }

    setMutating(true)
    try {
      await withLoading(t("loading.updatingPacks"), async () => {
        await Promise.all(ids.map((id) => setPackEnabled(id, enabled)))
        applyEnabled(ids, enabled)
        for (const id of usedIds) clearPackReferences(id)
      })
    } finally {
      setMutating(false)
    }
  }

  const handleDelete = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    const ok = await confirm(t("assets.deleteConfirm", { count: ids.length }), {
      title: t("assets.deleteTitle"),
      kind: "warning",
    })
    if (!ok) return
    setMutating(true)
    try {
      await withLoading(t("loading.deletingAssets"), async () => {
        // Each uninstall touches its own pack directory, so they are
        // independent and safe to run in parallel.
        await Promise.all(ids.map((id) => uninstallPack(id)))
        removePacks(ids)
        setSelected(new Set())
      })
    } finally {
      setMutating(false)
    }
  }

  const hasSelection = selected.size > 0

  const toolbar = (
    <HStack
      px="3"
      py="2"
      gap="2"
      borderBottomWidth="1px"
      borderColor="panel.border"
      flexWrap="wrap"
    >
      <Button size="xs" colorPalette="blue" onClick={install} loading={busy} disabled={hasMap}>
        <LuPackagePlus />
        {t("assets.install")}
      </Button>
      <Button size="xs" variant="subtle" onClick={() => openPacksDir()}>
        <LuFolderOpen />
        {t("assets.openFolder")}
      </Button>
      <Box w="1px" h="20px" bg="panel.border" />
      <Button
        size="xs"
        variant="subtle"
        disabled={!hasSelection || busy}
        onClick={() => setEnabledForSelected(true)}
      >
        <LuCirclePlay />
        {t("assets.activate")}
      </Button>
      <Button
        size="xs"
        variant="subtle"
        disabled={!hasSelection || busy}
        onClick={() => setEnabledForSelected(false)}
      >
        <LuCircleOff />
        {t("assets.deactivate")}
      </Button>
      <Button
        size="xs"
        variant="subtle"
        colorPalette="red"
        disabled={!hasSelection || busy || hasMap}
        onClick={handleDelete}
      >
        <LuTrash2 />
        {t("assets.delete")}
      </Button>
      <Box flex="1" />
      {hasMap && (
        <Badge colorPalette="orange" variant="subtle" title={t("assets.mapOpenHint")}>
          {t("assets.mapOpenBadge")}
        </Badge>
      )}
      <IconButton
        aria-label={t("assets.refresh")}
        size="xs"
        variant="ghost"
        onClick={refresh}
        disabled={busy}
      >
        <LuRefreshCw />
      </IconButton>
    </HStack>
  )

  return (
    <FloatingWindow
      title={t("assets.title")}
      icon={LuGem}
      onClose={onClose}
      initialPosition={{ x: 120, y: 90 }}
      initialSize={{ w: 760, h: 560 }}
      minSize={{ w: 560, h: 320 }}
      resizable
      modal
      toolbar={toolbar}
    >
      <Flex flex="1" minH="0">
        {/* Left: list column */}
        <Flex direction="column" flex="1" minW="0">
          <PackList
            packs={packs}
            loading={loading}
            selected={selected}
            focusedId={focusedId}
            progress={progress}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onFocus={setFocusedId}
          />
        </Flex>

        {/* Right: preview panel */}
        <PackPreview pack={focusedPack} />
      </Flex>
    </FloatingWindow>
  )
}
