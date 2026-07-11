import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  HStack,
  Icon,
  IconButton,
  Image,
  Progress,
  Spinner,
  Tag,
  Text,
  VStack,
  Wrap,
} from "@chakra-ui/react"
import { confirm } from "@tauri-apps/plugin-dialog"
import { Trans, useTranslation } from "react-i18next"
import {
  LuCircleOff,
  LuCirclePlay,
  LuFolderOpen,
  LuGem,
  LuImageOff,
  LuPackagePlus,
  LuRefreshCw,
  LuTrash2,
} from "react-icons/lu"
import { FloatingWindow } from "./FloatingWindow"
import { useLoading } from "../context/loading"
import { usePacks } from "../context/packs"
import { useMap } from "../context/map"
import {
  formatBytes,
  installPacks,
  loadPackThumbnail,
  onInstallProgress,
  openPacksDir,
  pickPackFiles,
  setPackEnabled,
  toDataUrl,
  uninstallPack,
  type InstallProgress,
  type InstalledPack,
} from "../lib/packs"

// -- one pack row --------------------------------------------------------------

interface PackRowProps {
  pack: InstalledPack
  selected: boolean
  focused: boolean
  disabled?: boolean
  onToggle: (id: string) => void
  onFocus: (id: string) => void
}

function PackRow({ pack, selected, focused, disabled, onToggle, onFocus }: PackRowProps) {
  const { t } = useTranslation()
  const [thumb, setThumb] = useState<string | null>(null)
  const [thumbState, setThumbState] = useState<"loading" | "ok" | "none">("loading")

  useEffect(() => {
    let alive = true
    setThumbState("loading")
    loadPackThumbnail(pack.id)
      .then((img) => {
        if (!alive) return
        if (img) {
          setThumb(toDataUrl(img))
          setThumbState("ok")
        } else {
          setThumbState("none")
        }
      })
      .catch(() => alive && setThumbState("none"))
    // Free the (potentially large) data-url when the row unmounts or pack changes.
    return () => {
      alive = false
      setThumb(null)
    }
  }, [pack.id])

  return (
    <Flex
      align="center"
      gap="3"
      px="3"
      py="2"
      cursor="pointer"
      bg={focused ? "panel.rowSelected" : "transparent"}
      _hover={{ bg: focused ? "panel.rowSelected" : "panel.rowHover" }}
      opacity={pack.enabled ? 1 : 0.55}
      onClick={() => onFocus(pack.id)}
    >
      <Box onClick={(e) => e.stopPropagation()} display="flex">
        <Checkbox.Root
          checked={selected}
          disabled={disabled}
          onCheckedChange={() => onToggle(pack.id)}
          colorPalette="blue"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
        </Checkbox.Root>
      </Box>

      <Box
        boxSize="42px"
        flexShrink={0}
        borderRadius="md"
        overflow="hidden"
        bg="panel.header"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        {thumbState === "loading" ? (
          <Spinner size="xs" color="fg.muted" />
        ) : thumbState === "ok" && thumb ? (
          <Image src={thumb} alt="" boxSize="42px" objectFit="cover" />
        ) : (
          <Icon as={LuImageOff} color="fg.muted" boxSize="4" />
        )}
      </Box>

      <Box flex="1" minW="0">
        <HStack gap="2">
          <Text fontWeight="semibold" truncate>
            {pack.name}
          </Text>
          {pack.version && (
            <Text fontSize="xs" color="fg.muted" flexShrink={0}>
              v{pack.version}
            </Text>
          )}
        </HStack>
        <Text fontSize="xs" color="fg.muted" truncate>
          {pack.author ? `${pack.author} · ` : ""}
          {t("assets.files", { count: pack.fileCount })} · {formatBytes(pack.sizeBytes)}
        </Text>
      </Box>

      <Badge flexShrink={0} colorPalette={pack.enabled ? "green" : "gray"} variant="subtle">
        {pack.enabled ? t("assets.active") : t("assets.inactive")}
      </Badge>
    </Flex>
  )
}

// -- preview panel -------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text fontSize="2xs" color="fg.muted" textTransform="uppercase" letterSpacing="wide">
        {label}
      </Text>
      <Text fontSize="sm" wordBreak="break-word">
        {value}
      </Text>
    </Box>
  )
}

function PackPreview({ pack }: { pack: InstalledPack | null }) {
  const { t } = useTranslation()
  const [img, setImg] = useState<string | null>(null)
  const [imgState, setImgState] = useState<"loading" | "ok" | "none">("none")

  useEffect(() => {
    if (!pack) {
      setImg(null)
      setImgState("none")
      return
    }
    let alive = true
    setImgState("loading")
    loadPackThumbnail(pack.id)
      .then((res) => {
        if (!alive) return
        if (res) {
          setImg(toDataUrl(res))
          setImgState("ok")
        } else {
          setImgState("none")
        }
      })
      .catch(() => alive && setImgState("none"))
    // Release the preview image bytes when switching packs / closing.
    return () => {
      alive = false
      setImg(null)
    }
  }, [pack?.id])

  if (!pack) {
    return (
      <Flex
        w="240px"
        flexShrink={0}
        borderLeftWidth="1px"
        borderColor="panel.border"
        bg="panel.header"
        align="center"
        justify="center"
        p="6"
      >
        <Text fontSize="sm" color="fg.muted" textAlign="center">
          {t("preview.empty")}
        </Text>
      </Flex>
    )
  }

  return (
    <Flex
      direction="column"
      w="240px"
      flexShrink={0}
      borderLeftWidth="1px"
      borderColor="panel.border"
      bg="panel.header"
      overflowY="auto"
    >
      <Box
        h="180px"
        flexShrink={0}
        bg="black/40"
        display="flex"
        alignItems="center"
        justifyContent="center"
        borderBottomWidth="1px"
        borderColor="panel.border"
      >
        {imgState === "loading" ? (
          <Spinner color="brand.fg" />
        ) : imgState === "ok" && img ? (
          <Image src={img} alt={pack.name} maxH="100%" maxW="100%" objectFit="contain" />
        ) : (
          <VStack color="fg.muted" gap="2">
            <Icon as={LuImageOff} boxSize="7" />
            <Text fontSize="xs">{t("preview.noImage")}</Text>
          </VStack>
        )}
      </Box>

      <VStack align="stretch" gap="3" p="4">
        <Box>
          <Text fontWeight="bold" fontSize="md" wordBreak="break-word">
            {pack.name}
          </Text>
          <Badge mt="1" colorPalette={pack.enabled ? "green" : "gray"} variant="subtle">
            {pack.enabled ? t("assets.active") : t("assets.inactive")}
          </Badge>
        </Box>
        {pack.author && <DetailRow label={t("preview.author")} value={pack.author} />}
        {pack.version && <DetailRow label={t("preview.version")} value={pack.version} />}
        <DetailRow label={t("preview.id")} value={pack.id} />
        <DetailRow label={t("preview.files")} value={String(pack.fileCount)} />
        <DetailRow label={t("preview.size")} value={formatBytes(pack.sizeBytes)} />
        {pack.keywords.length > 0 && (
          <Box>
            <Text
              fontSize="2xs"
              color="fg.muted"
              textTransform="uppercase"
              letterSpacing="wide"
              mb="1.5"
            >
              {t("preview.keywords")}
            </Text>
            <Wrap gap="1.5">
              {pack.keywords.map((kw) => (
                <Tag.Root key={kw} size="sm" variant="surface">
                  <Tag.Label>{kw}</Tag.Label>
                </Tag.Root>
              ))}
            </Wrap>
          </Box>
        )}
      </VStack>
    </Flex>
  )
}

// -- the manager window --------------------------------------------------------

export function AssetsManager({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { start, update, stop, withLoading } = useLoading()
  const { packs, loading, ensureLoaded, refresh, addOrUpdate, applyEnabled, removePacks } =
    usePacks()
  const { hasMap } = useMap()
  // While a map is open, the pack selection is locked (read-only).
  const readOnly = hasMap
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<InstallProgress | null>(null)

  // Keep latest t/update for the long-lived progress listener without
  // re-subscribing on every render.
  const tRef = useRef(t)
  tRef.current = t
  const installTaskRef = useRef<string | null>(null)

  useEffect(() => {
    // Load lazily on first open; reopening reuses the cached list.
    ensureLoaded()
    const unlisten = onInstallProgress((p) => {
      setProgress(p)
      if (installTaskRef.current) {
        update(installTaskRef.current, {
          message: tRef.current("loading.installingPack", { pack: p.pack }),
          progress: p.percent,
        })
      }
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [ensureLoaded, update])

  // Prune selection/focus when the cached list changes (e.g. after a delete).
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => packs.some((p) => p.id === id))))
    setFocusedId((prev) => (prev && packs.some((p) => p.id === prev) ? prev : null))
  }, [packs])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const focusedPack = useMemo(
    () => packs.find((p) => p.id === focusedId) ?? null,
    [packs, focusedId],
  )

  const allSelected = packs.length > 0 && selected.size === packs.length
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(packs.map((p) => p.id)))

  const handleInstall = async () => {
    const paths = await pickPackFiles()
    if (paths.length === 0) return
    setBusy(true)
    setProgress(null)
    const taskId = start(t("loading.installingAssets"))
    installTaskRef.current = taskId
    try {
      const installed = await installPacks(paths)
      // Merge into the cache instead of re-listing.
      addOrUpdate(installed)
    } catch (err) {
      await confirm(t("assets.installError", { error: String(err) }), {
        title: t("assets.errorTitle"),
        kind: "error",
      })
    } finally {
      installTaskRef.current = null
      stop(taskId)
      setBusy(false)
      setProgress(null)
    }
  }

  const setEnabledForSelected = async (enabled: boolean) => {
    const ids = [...selected]
    setBusy(true)
    try {
      await withLoading(t("loading.updatingPacks"), async () => {
        await Promise.all(ids.map((id) => setPackEnabled(id, enabled)))
        applyEnabled(ids, enabled)
      })
    } finally {
      setBusy(false)
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
    setBusy(true)
    try {
      await withLoading(t("loading.deletingAssets"), async () => {
        for (const id of ids) await uninstallPack(id)
        removePacks(ids)
        setSelected(new Set())
      })
    } finally {
      setBusy(false)
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
      <Button
        size="xs"
        colorPalette="blue"
        onClick={handleInstall}
        loading={busy}
        disabled={readOnly}
      >
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
        disabled={!hasSelection || busy || readOnly}
        onClick={() => setEnabledForSelected(true)}
      >
        <LuCirclePlay />
        {t("assets.activate")}
      </Button>
      <Button
        size="xs"
        variant="subtle"
        disabled={!hasSelection || busy || readOnly}
        onClick={() => setEnabledForSelected(false)}
      >
        <LuCircleOff />
        {t("assets.deactivate")}
      </Button>
      <Button
        size="xs"
        variant="subtle"
        colorPalette="red"
        disabled={!hasSelection || busy || readOnly}
        onClick={handleDelete}
      >
        <LuTrash2 />
        {t("assets.delete")}
      </Button>
      <Box flex="1" />
      {readOnly && (
        <Badge colorPalette="orange" variant="subtle" title={t("assets.readOnlyHint")}>
          {t("assets.readOnly")}
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
          {/* Select-all header */}
          {packs.length > 0 && (
            <HStack
              px="3"
              py="1.5"
              borderBottomWidth="1px"
              borderColor="panel.border"
              bg="panel.header"
              flexShrink={0}
            >
              <Checkbox.Root
                checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                disabled={readOnly}
                onCheckedChange={toggleAll}
                colorPalette="blue"
                size="sm"
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
              </Checkbox.Root>
              <Text fontSize="xs" color="fg.muted">
                {selected.size > 0
                  ? t("assets.selectedCount", { count: selected.size })
                  : t("assets.installedCount", { count: packs.length })}
              </Text>
            </HStack>
          )}

          {/* Progress */}
          {progress && (
            <Box px="3" py="2" borderBottomWidth="1px" borderColor="panel.border" flexShrink={0}>
              <Text fontSize="xs" color="fg.muted" mb="1" truncate>
                {t("assets.installing", {
                  pack: progress.pack,
                  index: progress.index,
                  total: progress.total,
                })}
              </Text>
              <Progress.Root value={progress.percent} size="xs" colorPalette="blue">
                <Progress.Track>
                  <Progress.Range />
                </Progress.Track>
              </Progress.Root>
            </Box>
          )}

          {/* List */}
          <Box flex="1" overflowY="auto">
            {loading ? (
              <Flex justify="center" align="center" h="full">
                <Spinner color="brand.fg" />
              </Flex>
            ) : packs.length === 0 ? (
              <VStack justify="center" h="full" gap="3" color="fg.muted" px="6">
                <Icon as={LuGem} boxSize="8" />
                <Text textAlign="center" fontSize="sm">
                  {t("assets.empty")}
                  <br />
                  <Trans i18nKey="assets.emptyHint">
                    Usá <b>Instalar</b> para agregar archivos .dungeondraft_pack.
                  </Trans>
                </Text>
              </VStack>
            ) : (
              packs.map((pack) => (
                <PackRow
                  key={pack.id}
                  pack={pack}
                  selected={selected.has(pack.id)}
                  focused={focusedId === pack.id}
                  disabled={readOnly}
                  onToggle={toggle}
                  onFocus={setFocusedId}
                />
              ))
            )}
          </Box>
        </Flex>

        {/* Right: preview panel */}
        <PackPreview pack={focusedPack} />
      </Flex>
    </FloatingWindow>
  )
}
