import { useCallback, useEffect, useState } from "react"
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
  Text,
  VStack,
} from "@chakra-ui/react"
import { confirm } from "@tauri-apps/plugin-dialog"
import {
  LuCircleOff,
  LuCirclePlay,
  LuGem,
  LuImageOff,
  LuPackagePlus,
  LuRefreshCw,
  LuTrash2,
} from "react-icons/lu"
import { FloatingWindow } from "./FloatingWindow"
import {
  formatBytes,
  installPacks,
  listInstalled,
  loadPackThumbnail,
  onInstallProgress,
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
  onToggle: (id: string) => void
}

function PackRow({ pack, selected, onToggle }: PackRowProps) {
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
      bg={selected ? "panel.rowSelected" : "transparent"}
      _hover={{ bg: selected ? "panel.rowSelected" : "panel.rowHover" }}
      opacity={pack.enabled ? 1 : 0.55}
      onClick={() => onToggle(pack.id)}
    >
      <Checkbox.Root
        checked={selected}
        onCheckedChange={() => onToggle(pack.id)}
        colorPalette="blue"
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control />
      </Checkbox.Root>

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
          {pack.fileCount} archivos · {formatBytes(pack.sizeBytes)}
        </Text>
      </Box>

      <Badge
        flexShrink={0}
        colorPalette={pack.enabled ? "green" : "gray"}
        variant="subtle"
      >
        {pack.enabled ? "Activo" : "Inactivo"}
      </Badge>
    </Flex>
  )
}

// -- the manager window --------------------------------------------------------

export function AssetsManager({ onClose }: { onClose: () => void }) {
  const [packs, setPacks] = useState<InstalledPack[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<InstallProgress | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listInstalled()
      setPacks(list)
      // Drop selections that no longer exist.
      setSelected((prev) => new Set([...prev].filter((id) => list.some((p) => p.id === id))))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const unlisten = onInstallProgress(setProgress)
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [refresh])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const allSelected = packs.length > 0 && selected.size === packs.length
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(packs.map((p) => p.id)))

  const handleInstall = async () => {
    const paths = await pickPackFiles()
    if (paths.length === 0) return
    setBusy(true)
    setProgress(null)
    try {
      await installPacks(paths)
      await refresh()
    } catch (err) {
      await confirm(`No se pudo instalar: ${err}`, { title: "Error", kind: "error" })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const setEnabledForSelected = async (enabled: boolean) => {
    setBusy(true)
    try {
      await Promise.all([...selected].map((id) => setPackEnabled(id, enabled)))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    const ok = await confirm(
      `¿Eliminar ${ids.length} pack(s)? Se borrarán los archivos del disco.`,
      { title: "Desinstalar activos", kind: "warning" },
    )
    if (!ok) return
    setBusy(true)
    try {
      for (const id of ids) await uninstallPack(id)
      setSelected(new Set())
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const hasSelection = selected.size > 0

  return (
    <FloatingWindow
      title="Activos"
      icon={LuGem}
      onClose={onClose}
      initialPosition={{ x: 120, y: 90 }}
    >
      {/* Toolbar */}
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
        >
          <LuPackagePlus />
          Instalar
        </Button>
        <Box w="1px" h="20px" bg="panel.border" />
        <Button
          size="xs"
          variant="subtle"
          disabled={!hasSelection || busy}
          onClick={() => setEnabledForSelected(true)}
        >
          <LuCirclePlay />
          Activar
        </Button>
        <Button
          size="xs"
          variant="subtle"
          disabled={!hasSelection || busy}
          onClick={() => setEnabledForSelected(false)}
        >
          <LuCircleOff />
          Desactivar
        </Button>
        <Button
          size="xs"
          variant="subtle"
          colorPalette="red"
          disabled={!hasSelection || busy}
          onClick={handleDelete}
        >
          <LuTrash2 />
          Eliminar
        </Button>
        <Box flex="1" />
        <IconButton
          aria-label="Refrescar"
          size="xs"
          variant="ghost"
          onClick={refresh}
          disabled={busy}
        >
          <LuRefreshCw />
        </IconButton>
      </HStack>

      {/* Select-all header */}
      {packs.length > 0 && (
        <HStack
          px="3"
          py="1.5"
          borderBottomWidth="1px"
          borderColor="panel.border"
          bg="panel.header"
        >
          <Checkbox.Root
            checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
            onCheckedChange={toggleAll}
            colorPalette="blue"
            size="sm"
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
          </Checkbox.Root>
          <Text fontSize="xs" color="fg.muted">
            {selected.size > 0
              ? `${selected.size} seleccionado(s)`
              : `${packs.length} pack(s) instalado(s)`}
          </Text>
        </HStack>
      )}

      {/* Progress */}
      {progress && (
        <Box px="3" py="2" borderBottomWidth="1px" borderColor="panel.border">
          <Text fontSize="xs" color="fg.muted" mb="1" truncate>
            Instalando “{progress.pack}” — {progress.index}/{progress.total}
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
              No hay activos instalados.
              <br />
              Usá <b>Instalar</b> para agregar archivos .dungeondraft_pack.
            </Text>
          </VStack>
        ) : (
          packs.map((pack) => (
            <PackRow
              key={pack.id}
              pack={pack}
              selected={selected.has(pack.id)}
              onToggle={toggle}
            />
          ))
        )}
      </Box>
    </FloatingWindow>
  )
}
