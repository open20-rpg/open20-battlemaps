import { useEffect, useState } from "react"
import {
  Badge,
  Box,
  Checkbox,
  Flex,
  HStack,
  Icon,
  Image,
  Progress,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react"
import { Trans, useTranslation } from "react-i18next"
import { LuGem, LuImageOff } from "react-icons/lu"
import { loadPackThumbnail, toDataUrl, type InstalledPack, type InstallProgress } from "../api"
import { formatBytes } from "../../../lib/format"

// -- one pack row --------------------------------------------------------------

interface PackRowProps {
  pack: InstalledPack
  selected: boolean
  focused: boolean
  disabled?: boolean
  onToggle: (id: string) => void
  onFocus: (id: string) => void
}

interface ThumbState {
  /** Pack the thumbnail belongs to, so stale state resets during render. */
  id: string
  url: string | null
  status: "loading" | "ok" | "none"
}

function PackRow({ pack, selected, focused, disabled, onToggle, onFocus }: PackRowProps) {
  const { t } = useTranslation()
  const [thumb, setThumb] = useState<ThumbState>({ id: pack.id, url: null, status: "loading" })

  // Reset while rendering when the row is reused for another pack; this also
  // frees the (potentially large) previous data-url right away.
  if (thumb.id !== pack.id) {
    setThumb({ id: pack.id, url: null, status: "loading" })
  }

  useEffect(() => {
    let alive = true
    loadPackThumbnail(pack.id)
      .then((img) => {
        if (!alive) return
        setThumb(
          img
            ? { id: pack.id, url: toDataUrl(img), status: "ok" }
            : { id: pack.id, url: null, status: "none" },
        )
      })
      .catch(() => {
        if (alive) setThumb({ id: pack.id, url: null, status: "none" })
      })
    return () => {
      alive = false
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
          colorPalette="brand"
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
        {thumb.status === "loading" ? (
          <Spinner size="xs" color="fg.muted" />
        ) : thumb.status === "ok" && thumb.url ? (
          <Image src={thumb.url} alt="" boxSize="42px" objectFit="cover" />
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

      {pack.editable && (
        <Badge flexShrink={0} colorPalette="brand" variant="subtle">
          {t("userPacks.mine")}
        </Badge>
      )}
      <Badge flexShrink={0} colorPalette={pack.enabled ? "green" : "gray"} variant="subtle">
        {pack.enabled ? t("assets.active") : t("assets.inactive")}
      </Badge>
    </Flex>
  )
}

// -- the list column -----------------------------------------------------------

interface PackListProps {
  packs: InstalledPack[]
  loading: boolean
  selected: Set<string>
  focusedId: string | null
  /** Install progress shown between the header and the list, when present. */
  progress: InstallProgress | null
  onToggle: (id: string) => void
  onToggleAll: () => void
  onFocus: (id: string) => void
}

export function PackList({
  packs,
  loading,
  selected,
  focusedId,
  progress,
  onToggle,
  onToggleAll,
  onFocus,
}: PackListProps) {
  const { t } = useTranslation()
  const allSelected = packs.length > 0 && selected.size === packs.length

  return (
    <>
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
            onCheckedChange={onToggleAll}
            colorPalette="brand"
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
          <Progress.Root value={progress.percent} size="xs" colorPalette="brand">
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
              <br />
              <Trans i18nKey="userPacks.emptyCreateHint">
                O <b>Creá un pack</b> con tus propias imágenes.
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
              onToggle={onToggle}
              onFocus={onFocus}
            />
          ))
        )}
      </Box>
    </>
  )
}
