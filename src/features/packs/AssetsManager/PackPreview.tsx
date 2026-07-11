import { useEffect, useState } from "react"
import { Badge, Box, Flex, Icon, Image, Spinner, Tag, Text, VStack, Wrap } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuImageOff } from "react-icons/lu"
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

interface PreviewImageState {
  /** Pack the image belongs to, so stale state resets during render. */
  id: string | null
  url: string | null
  status: "loading" | "ok" | "none"
}

export function PackPreview({ pack }: { pack: InstalledPack | null }) {
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
