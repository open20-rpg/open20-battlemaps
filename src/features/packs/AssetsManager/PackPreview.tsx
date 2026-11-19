import { useEffect, useState } from "react"
import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Image,
  Spinner,
  Tag,
  Text,
  VStack,
  Wrap,
} from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuDownload, LuImageOff, LuLock, LuPencil } from "react-icons/lu"
import { usePacksStore } from "../../../stores/packsStore"
import { exportPack } from "../exportPack"
import { loadPackThumbnail, toDataUrl, type InstalledPack } from "../api"
import { formatBytes } from "../../../lib/format"

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

function PackBadges({ pack }: { pack: InstalledPack }) {
  const { t } = useTranslation()
  return (
    <HStack mt="1" gap="1.5">
      <Badge colorPalette={pack.enabled ? "green" : "gray"} variant="subtle">
        {pack.enabled ? t("assets.active") : t("assets.inactive")}
      </Badge>
      {pack.editable && (
        <Badge colorPalette="brand" variant="subtle">
          {t("userPacks.mine")}
        </Badge>
      )}
    </HStack>
  )
}

/** A pack made in the app is edited and exported from here; an installed one is read-only. */
function PackActions({ pack }: { pack: InstalledPack }) {
  const { t } = useTranslation()
  if (!pack.editable) {
    return (
      <HStack gap="1.5" color="fg.subtle" fontSize="xs">
        <LuLock />
        <Text>{t("userPacks.readOnly")}</Text>
      </HStack>
    )
  }
  return (
    <VStack align="stretch" gap="1.5">
      <Button
        size="sm"
        colorPalette="brand"
        onClick={() => usePacksStore.getState().openEditor(pack.id)}
      >
        <LuPencil />
        {t("userPacks.edit")}
      </Button>
      <Button size="sm" variant="subtle" onClick={() => void exportPack(pack)}>
        <LuDownload />
        {t("userPacks.export")}
      </Button>
    </VStack>
  )
}

interface PreviewImageState {
  /** Pack the image belongs to, so stale state resets during render. */
  id: string | null
  url: string | null
  status: "loading" | "ok" | "none"
}

/** The side panel's box: a column on the right, or (stacked on a phone) a band below the list. */
const sideBox = (stacked: boolean) =>
  stacked
    ? { w: "full", maxH: "45%", flexShrink: 0, borderTopWidth: "1px" }
    : { w: "240px", flexShrink: 0, borderLeftWidth: "1px" }

export function PackPreview({
  pack,
  stacked = false,
}: {
  pack: InstalledPack | null
  /** Below the list (phones) instead of beside it. */
  stacked?: boolean
}) {
  const { t } = useTranslation()
  const packId = pack?.id ?? null
  const [img, setImg] = useState<PreviewImageState>({
    id: packId,
    url: null,
    status: packId ? "loading" : "none",
  })

  // Reset while rendering when switching packs / closing; this also releases
  // the previous preview image bytes right away.
  if (img.id !== packId) {
    setImg({ id: packId, url: null, status: packId ? "loading" : "none" })
  }

  useEffect(() => {
    if (!packId) return
    let alive = true
    loadPackThumbnail(packId)
      .then((res) => {
        if (!alive) return
        setImg(
          res
            ? { id: packId, url: toDataUrl(res), status: "ok" }
            : { id: packId, url: null, status: "none" },
        )
      })
      .catch(() => {
        if (alive) setImg({ id: packId, url: null, status: "none" })
      })
    return () => {
      alive = false
    }
  }, [packId])

  if (!pack) {
    return (
      <Flex
        {...sideBox(stacked)}
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
      {...sideBox(stacked)}
      borderColor="panel.border"
      bg="panel.header"
      overflowY="auto"
    >
      {/* Stacked on a phone, room goes to the details and actions, not the cover. */}
      <Box
        h="180px"
        display={stacked ? "none" : "flex"}
        flexShrink={0}
        bg="black/40"
        alignItems="center"
        justifyContent="center"
        borderBottomWidth="1px"
        borderColor="panel.border"
      >
        {img.status === "loading" ? (
          <Spinner color="brand.fg" />
        ) : img.status === "ok" && img.url ? (
          <Image src={img.url} alt={pack.name} maxH="100%" maxW="100%" objectFit="contain" />
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
          <PackBadges pack={pack} />
        </Box>
        <PackActions pack={pack} />
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
