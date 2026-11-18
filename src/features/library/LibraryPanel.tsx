import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Box, Flex, Icon, Tabs, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuLibrary } from "react-icons/lu"
import { AssetSelector } from "./AssetSelector"
import { libraryTags } from "./api"
import { selectActiveTool, useToolsStore } from "../../stores/toolsStore"
import { useMapStore } from "../../stores/mapStore"
import { withLoading } from "../../stores/loadingStore"
import { DEFAULT_CUSTOM_COLOR } from "../../lib/colors"
import { type AssetCategory } from "../../lib/categories"
import { usedAssetIds } from "../map/packUsage"
import { useViewportCover } from "../map/render/focus"
import { LIBRARY_PARAM, libraryAssetsOf } from "../tools/params"
import { Select } from "../../ui/Select"
import { useSettingsStore } from "../../stores/settingsStore"
import { libraryColumnsFor, libraryWidth } from "./panelWidth"

// -- the sticky Library panel --------------------------------------------------

/**
 * The docked Library's left edge: dragging it widens or narrows the panel a
 * whole thumbnail column at a time (4 to 8), so the grid always fits. The
 * column count is a remembered preference.
 */
function WidthHandle({ label }: { label: string }) {
  const setColumns = useSettingsStore((s) => s.setLibraryColumns)
  const [dragging, setDragging] = useState(false)

  const resizeTo = (e: ReactPointerEvent<HTMLDivElement>) => {
    const panel = e.currentTarget.parentElement
    if (!panel) return
    const next = libraryColumnsFor(panel.getBoundingClientRect().right - e.clientX)
    if (next !== useSettingsStore.getState().libraryColumns) setColumns(next)
  }

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      position="absolute"
      left="-3px"
      top="0"
      bottom="0"
      w="6px"
      zIndex="1"
      cursor="col-resize"
      touchAction="none"
      bg={dragging ? "brand.fg" : "transparent"}
      _hover={{ bg: "brand.fg/60" }}
      transition="background 0.15s"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (dragging) resizeTo(e)
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId)
        setDragging(false)
      }}
      onPointerCancel={() => setDragging(false)}
    />
  )
}

/**
 * The Library on the right: browse a category's assets across enabled packs
 * (All), only those already placed on the map (Used) or a pack tag (Tags).
 * For tools that place library items (Object, Scatter, Path) the browser is
 * selectable and the pick is stored in the tool's params.
 */
export function LibraryPanel({
  category,
  embedded = false,
}: {
  category: AssetCategory
  /** Inside another container (the phone layout's sheet) instead of docked on the right. */
  embedded?: boolean
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  // Docked over the canvas's right edge (not inside the phone's sheet).
  useViewportCover(ref, "right", !embedded)
  const [tab, setTab] = useState("all")
  const columns = useSettingsStore((s) => s.libraryColumns)

  const tool = useToolsStore(selectActiveTool)
  const toolId = tool?.id
  const select = tool?.librarySelect
  const setToolParams = useToolsStore((s) => s.setToolParams)
  // Colorable items are shown recolored with the active tool's custom color.
  const color = useToolsStore((s) => {
    const stored = toolId ? s.paramsByTool[toolId]?.customColor : undefined
    return typeof stored === "string" ? stored : DEFAULT_CUSTOM_COLOR
  })
  // Selected as a joined string: a store selector must return a stable value
  // (a fresh array each call makes useSyncExternalStore loop forever).
  const selectedKey = useToolsStore((s) =>
    toolId ? libraryAssetsOf(s.paramsByTool[toolId] ?? {}).join("\n") : "",
  )
  // Stable array identity per selection (the selector memoizes on it).
  const selection = useMemo(() => (selectedKey ? selectedKey.split("\n") : []), [selectedKey])
  const onSelectionChange =
    select && toolId
      ? (ids: string[]) => setToolParams(toolId, { [LIBRARY_PARAM]: ids })
      : undefined

  const map = useMapStore((s) => s.map)
  const usedKey = usedAssetIds(map, category).join("\n")
  const used = useMemo(() => (usedKey ? usedKey.split("\n") : []), [usedKey])

  const shared = {
    category,
    color,
    select,
    selectedIds: selection,
    onSelectionChange,
    showPreview: true,
  }

  return (
    <Flex
      ref={ref}
      {...(embedded
        ? { flex: "1", minH: "0", w: "full" }
        : {
            position: "absolute",
            right: "0",
            top: "0",
            bottom: "0",
            zIndex: "docked",
            w: `${libraryWidth(columns)}px`,
            maxW: "80%",
            borderLeftWidth: "1px",
          })}
      direction="column"
      bg="panel.bg"
      borderColor="panel.border"
    >
      {!embedded && <WidthHandle label={t("library.resize")} />}
      {/* Embedded, its container already names it (the phone sheet's tab). */}
      {!embedded && (
        <Flex
          align="center"
          gap="2"
          px="3"
          py="2.5"
          bg="panel.header"
          borderBottomWidth="1px"
          borderColor="panel.border"
          flexShrink={0}
        >
          <Icon as={LuLibrary} color="brand.fg" boxSize="4" />
          <Text fontWeight="bold" fontSize="sm">
            {t("library.title")}
          </Text>
        </Flex>
      )}

      <Tabs.Root
        value={tab}
        onValueChange={(e) => setTab(e.value)}
        variant="line"
        size="sm"
        display="flex"
        flexDirection="column"
        flex="1"
        minH="0"
        lazyMount
        unmountOnExit
      >
        <Tabs.List flexShrink={0} px="2">
          <Tabs.Trigger value="all">{t("library.tabAll")}</Tabs.Trigger>
          <Tabs.Trigger value="used">{t("library.tabUsed")}</Tabs.Trigger>
          <Tabs.Trigger value="tags">{t("library.tabTags")}</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="all" flex="1" minH="0" p="0" display="flex" flexDirection="column">
          <AssetSelector browserKey={`library:${category}`} {...shared} />
        </Tabs.Content>
        <Tabs.Content value="used" flex="1" minH="0" p="0" display="flex" flexDirection="column">
          {used.length === 0 ? (
            <Flex flex="1" align="center" justify="center" color="fg.muted" fontSize="sm" p="6">
              <Text textAlign="center">{t("library.noneUsed")}</Text>
            </Flex>
          ) : (
            <AssetSelector browserKey={`library-used:${category}`} onlyIds={used} {...shared} />
          )}
        </Tabs.Content>
        <Tabs.Content value="tags" flex="1" minH="0" p="0" display="flex" flexDirection="column">
          <TagBrowser category={category} shared={shared} />
        </Tabs.Content>
      </Tabs.Root>
    </Flex>
  )
}

type SharedSelectorProps = Omit<Parameters<typeof AssetSelector>[0], "browserKey">

/** The Tags tab: pick a pack tag, browse its assets. */
function TagBrowser({
  category,
  shared,
}: {
  category: AssetCategory
  shared: SharedSelectorProps
}) {
  const { t } = useTranslation()
  const [tags, setTags] = useState<{ category: string; names: string[] } | null>(null)
  const [tag, setTag] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void withLoading(t("loading.searchingLibrary"), () => libraryTags(category))
      .then((names) => {
        if (!cancelled) setTags({ category, names })
      })
      .catch(() => {
        if (!cancelled) setTags({ category, names: [] })
      })
    return () => {
      cancelled = true
    }
  }, [category, t])

  // Results for another category are stale until the new list arrives.
  const names = tags?.category === category ? tags.names : []
  const current = tag && names.includes(tag) ? tag : (names[0] ?? null)

  if (names.length === 0) {
    return (
      <Flex flex="1" align="center" justify="center" color="fg.muted" fontSize="sm" p="6">
        <Text textAlign="center">{tags ? t("library.noTags") : t("library.loadingTags")}</Text>
      </Flex>
    )
  }
  return (
    <Flex direction="column" flex="1" minH="0">
      <Flex px="3" pt="2.5" flexShrink={0}>
        <Select
          value={current ?? ""}
          items={names.map((name) => ({ value: name, label: name }))}
          onChange={setTag}
        />
      </Flex>
      {current && (
        <AssetSelector browserKey={`library-tag:${category}`} tag={current} {...shared} />
      )}
    </Flex>
  )
}
