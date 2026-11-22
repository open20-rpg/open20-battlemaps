import { useEffect, useState } from "react"
import { Box, Grid, Image, Input, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { type AssetInfo, type Contribution } from "@open20/battlemaps-sdk"
import { type LiveContribution } from "../../../stores/extensionsStore"

type Tab = LiveContribution<Extract<Contribution, { type: "libraryTab" }>>

/** Thumbnails shown only from the app's own files or inline images (no remote URLs). */
const safeThumb = (url: string | undefined) =>
  url && (/^(asset|https?:\/\/asset\.localhost|data:image\/)/.test(url) ? url : undefined)

/**
 * A Library tab an extension adds: its search over its own source of
 * assets; picking one selects it for the active tool like any Library item.
 */
export function ExtensionLibraryTab({
  tab,
  category,
  selectedIds,
  onSelect,
}: {
  tab: Tab
  category: string
  selectedIds: readonly string[]
  onSelect?: (ids: string[]) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<AssetInfo[]>([])
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      void Promise.resolve(
        tab.contribution.search({ query, category: category as never, limit: 200 }),
      )
        .then((r) => alive && setItems(Array.isArray(r) ? r.slice(0, 200) : []))
        .catch(() => alive && setItems([]))
    }, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [tab, query, category])
  return (
    <Stack flex="1" minH="0" p="2" gap="2">
      <Input
        size="xs"
        placeholder={t("library.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {items.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" textAlign="center" p="4">
          {t("extensions.noResults")}
        </Text>
      ) : (
        <Grid templateColumns="repeat(auto-fill, minmax(72px, 1fr))" gap="1.5" overflowY="auto">
          {items.map((a) => {
            const thumb = safeThumb(a.thumbnail)
            const on = selectedIds.includes(a.id)
            return (
              <Box
                key={a.id}
                as="button"
                borderWidth="2px"
                borderColor={on ? "brand.solid" : "transparent"}
                borderRadius="md"
                p="1"
                bg="panel.rowHover"
                onClick={() => onSelect?.([a.id])}
                aria-pressed={on}
                aria-label={a.name}
              >
                {thumb ? (
                  <Image src={thumb} alt="" aspectRatio={1} objectFit="contain" />
                ) : (
                  <Box aspectRatio={1} />
                )}
                <Text fontSize="2xs" truncate>
                  {a.name}
                </Text>
              </Box>
            )
          })}
        </Grid>
      )}
    </Stack>
  )
}
