import { useEffect, useRef, useState } from "react"
import { Box, Flex, Input, Text } from "@chakra-ui/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useTranslation } from "react-i18next"
import { Select } from "../../../ui/Select"
import { toaster } from "../../../ui/chakra/toaster-instance"
import { withLoading } from "../../../stores/loadingStore"
import { listSystemFonts } from "../../fonts/api"
import {
  findFamily,
  loadCatalog,
  nearestStyle,
  styleName,
  type CatalogFamily,
  type FontChoice,
} from "../../fonts/catalog"
import { ensureFont } from "../../fonts/registry"

const ROW_H = 30
const LIST_H = 240

/** A family in the list: "" is the default font. */
interface FontRow {
  family: string
  source: "default" | "google" | "system"
}

interface FontSources {
  google: CatalogFamily[]
  system: string[]
}

// Neither list changes during a session: load once, share across mounts.
let sources: Promise<FontSources> | undefined
const loadSources = (message: string) =>
  (sources ??= withLoading(message, async () => {
    const [google, system] = await Promise.all([
      loadCatalog(),
      listSystemFonts().catch(() => [] as string[]),
    ])
    return { google, system }
  }))

/** The styles to offer: a Google family's own, or the usual four for a system one. */
function stylesOf(fam: CatalogFamily | undefined): [number, boolean][] {
  if (!fam) {
    return [
      [400, false],
      [400, true],
      [700, false],
      [700, true],
    ]
  }
  return fam.s.map(([w, i]) => [w, !!i])
}

const styleKey = (weight: number, italic: boolean) => `${weight}:${italic ? 1 : 0}`

/**
 * Font selector: a searchable list of the Google Fonts catalog and the
 * system's families, then the chosen family's style. Picking a Google font
 * downloads that style (once: it's cached for offline use).
 */
export function FontControl({
  value,
  labelKey,
  onChange,
}: {
  value: FontChoice
  labelKey: string
  onChange: (value: FontChoice) => void
}) {
  const { t } = useTranslation()
  const [fonts, setFonts] = useState<FontSources | null>(null)
  const [query, setQuery] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void loadSources(t("loading.loadingFonts")).then((loaded) => {
      if (!cancelled) setFonts(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [t])

  const google = fonts?.google ?? []
  const googleNames = new Set(google.map((f) => f.f))
  const q = query.trim().toLowerCase()
  const rows: FontRow[] = [
    ...(q ? [] : [{ family: "", source: "default" as const }]),
    ...[
      ...google.map((f) => ({ family: f.f, source: "google" as const })),
      ...(fonts?.system ?? [])
        .filter((f) => !googleNames.has(f))
        .map((f) => ({ family: f, source: "system" as const })),
    ]
      .filter((r) => !q || r.family.toLowerCase().includes(q))
      .sort((a, b) => a.family.localeCompare(b.family)),
  ]

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  })

  const family = findFamily(google, value.family)

  /** Apply a choice; a Google font's style is fetched (and cached) first-time. */
  const choose = (next: FontChoice) => {
    onChange(next)
    if (!findFamily(google, next.family)) return
    ensureFont(next, true).catch((err: unknown) =>
      toaster.create({
        title: t("toast.fontDownloadError", { font: next.family, error: String(err) }),
        type: "error",
      }),
    )
  }

  const pick = (row: FontRow) => {
    const fam = findFamily(google, row.family)
    if (!fam) return choose({ ...value, family: row.family })
    const [weight, italic] = nearestStyle(fam, value.weight, value.italic)
    choose({ family: row.family, weight, italic: !!italic })
  }

  const styles = stylesOf(family)
  const styleItems = styles.map(([w, i]) => ({ value: styleKey(w, i), label: styleName(w, i) }))

  return (
    <Box px="3" py="1.5">
      <Text mb="2" fontSize="xs" color="fg.muted">
        {t(labelKey)}
      </Text>
      <Input
        size="sm"
        mb="2"
        value={query}
        placeholder={t("tools.fontSearch")}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <Box
        ref={scrollRef}
        h={`${LIST_H}px`}
        overflowY="auto"
        borderWidth="1px"
        borderColor="panel.border"
        borderRadius="md"
        bg="panel.solid"
      >
        <Box position="relative" h={`${virtualizer.getTotalSize()}px`}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            const selected = row.family === value.family
            return (
              <Flex
                key={item.key}
                as="button"
                position="absolute"
                top="0"
                left="0"
                w="full"
                h={`${ROW_H}px`}
                transform={`translateY(${item.start}px)`}
                align="center"
                gap="2"
                px="2.5"
                textAlign="left"
                cursor="pointer"
                bg={selected ? "brand.muted" : undefined}
                color={selected ? "brand.fg" : undefined}
                _hover={{ bg: selected ? "brand.muted" : "bg.muted" }}
                onClick={() => pick(row)}
              >
                <Text
                  flex="1"
                  truncate
                  fontSize="sm"
                  // System fonts preview in their own face (Google ones aren't downloaded yet).
                  style={row.source === "system" ? { fontFamily: `"${row.family}"` } : undefined}
                >
                  {row.source === "default" ? t("tools.fontDefault") : row.family}
                </Text>
                {row.source !== "default" && (
                  <Text fontSize="2xs" color="fg.muted" flexShrink={0}>
                    {t(row.source === "google" ? "tools.fontGoogle" : "tools.fontSystem")}
                  </Text>
                )}
              </Flex>
            )
          })}
        </Box>
      </Box>
      {value.family && (
        <Box mt="2">
          <Text mb="1.5" fontSize="xs" color="fg.muted">
            {t("tools.fontStyle")}
          </Text>
          <Select
            value={styleKey(value.weight, value.italic)}
            items={styleItems}
            onChange={(key) => {
              const [w, i] = key.split(":")
              choose({ ...value, weight: Number(w), italic: i === "1" })
            }}
          />
        </Box>
      )}
    </Box>
  )
}
