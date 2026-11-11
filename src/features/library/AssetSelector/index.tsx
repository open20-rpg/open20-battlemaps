import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { Box, Flex, Text } from "@chakra-ui/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useTranslation } from "react-i18next"
import { usePreviewStore } from "../../../stores/previewStore"
import { itemImageUrl, type LibItem, type ThumbColoring } from "../api"
import { ListCell, NullCell, ThumbCell } from "./cells"
import {
  CELL,
  GAP,
  LIST_CATEGORIES,
  TINTED_CATEGORIES,
  LIST_ROW_EST,
  THUMB_CSS,
  fillerStyle,
  gridRowStyle,
  listRowStyle,
  tipArrowStyle,
  tipStyle,
} from "./constants"
import { SearchBar } from "./SearchBar"
import { useAssetSearch } from "./useAssetSearch"

// -- reusable asset browser (search + virtualized grid + optional selection) ---

export interface AssetSelectorProps {
  /** Unique per-instance id for the backend result cache (lets several coexist). */
  browserKey: string
  /** Asset category to search (e.g. "objects", "floors", "walls"). */
  category: string
  /** Recolor color for colorable thumbnails. */
  color: string
  /** Selection mode. Omit for a non-selectable browser (e.g. the main Library). */
  select?: "single" | "multi"
  /** Selected item ids (controlled). */
  selectedIds?: string[]
  /** `picked`: the item a single click chose (e.g. to apply its default color). */
  onSelectionChange?: (ids: string[], picked?: LibItem) => void
  /** Drive the shared hover/press preview panel (used by the Library). */
  showPreview?: boolean
  /** Show the search box + exactness slider (hidden for param pickers). */
  showSearch?: boolean
  /** Show an empty first cell that selects "no asset" (empty selection). */
  allowNull?: boolean
  /** Only show textures in this pack tag. */
  tag?: string
  /** Only show these asset ids. */
  onlyIds?: string[]
}

/** Each category's (stable) thumbnail coloring. */
const COLORINGS = new Map<string, ThumbColoring>()

/**
 * How a category's thumbnails take the color: walls and tilesets are tinted
 * (Dungeondraft multiplies them); colorable ones — and objects — have their
 * red regions recolored, tilesets by their own rule.
 */
function coloringOf(category: string): ThumbColoring {
  let c = COLORINGS.get(category)
  if (!c) {
    c = {
      tint: TINTED_CATEGORIES.has(category),
      recolorMode: category === "tilesets" ? "tileset" : "object",
    }
    COLORINGS.set(category, c)
  }
  return c
}

export function AssetSelector({
  browserKey,
  category,
  color,
  select,
  selectedIds,
  onSelectionChange,
  showPreview = false,
  showSearch = true,
  allowNull = false,
  tag,
  onlyIds,
}: AssetSelectorProps) {
  const { t } = useTranslation()
  const coloring = coloringOf(category)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(1)
  // Wall/path thumbs vary in size -> single-column list at natural size.
  const layout = LIST_CATEGORIES.has(category) ? "list" : "grid"

  const {
    items,
    total,
    searchGen,
    nullOffset,
    queryInput,
    setQueryInput,
    exactness,
    setExactness,
    runSearch,
    loadVisibleRows,
    ensureLoaded,
  } = useAssetSearch({
    browserKey,
    category,
    tag,
    onlyIds,
    allowNull,
    select,
    selectedIds,
    onSelectionChange,
    scrollRef,
  })

  const selectedSet = useMemo(() => new Set(selectedIds ?? []), [selectedIds])
  // Anchor for shift-range selection.
  const anchorIdx = useRef<number | null>(null)

  // Shared name tooltip via event delegation (see LibraryPanel history).
  const [tip, setTip] = useState<{ name: string; x: number; y: number } | null>(null)
  const tipTimer = useRef<number | undefined>(undefined)

  const setPreview = usePreviewStore((s) => s.setPreview)
  const previewIdx = useRef<number | null>(null)

  const handlePointerOver = useCallback(
    (e: ReactPointerEvent) => {
      const cell = (e.target as HTMLElement).closest?.("[data-idx]") as HTMLElement | null
      if (!cell) {
        window.clearTimeout(tipTimer.current)
        return
      }
      const idx = Number(cell.dataset.idx)
      const name = cell.dataset.name ?? ""
      window.clearTimeout(tipTimer.current)
      const rect = cell.getBoundingClientRect()
      tipTimer.current = window.setTimeout(
        () => setTip({ name, x: rect.left + rect.width / 2, y: rect.top }),
        250,
      )
      if (showPreview && previewIdx.current !== idx) {
        previewIdx.current = idx
        const item = items.current.get(idx)
        setPreview(
          item
            ? {
                name: item.name,
                thumbUrl: itemImageUrl(item, item.thumb, color, coloring),
                fullUrl: itemImageUrl(item, item.full, color, coloring),
              }
            : null,
        )
      }
    },
    [items, setPreview, showPreview, color, coloring],
  )

  const clearAll = useCallback(() => {
    window.clearTimeout(tipTimer.current)
    setTip(null)
    if (showPreview) {
      previewIdx.current = null
      setPreview(null)
    }
  }, [setPreview, showPreview])

  const handleClick = useCallback(
    async (e: ReactMouseEvent) => {
      if (!select || !onSelectionChange) return
      // The empty/null cell clears the selection.
      if ((e.target as HTMLElement).closest?.("[data-null]")) {
        onSelectionChange([])
        anchorIdx.current = null
        return
      }
      const cell = (e.target as HTMLElement).closest?.("[data-idx]") as HTMLElement | null
      if (!cell) return
      const idx = Number(cell.dataset.idx)
      const item = items.current.get(idx)
      if (!item) return

      if (select === "single") {
        onSelectionChange([item.id], item)
        anchorIdx.current = idx
        return
      }
      // multi
      if (e.shiftKey && anchorIdx.current != null) {
        const from = Math.min(anchorIdx.current, idx)
        const to = Math.max(anchorIdx.current, idx)
        await ensureLoaded(from, to)
        const ids: string[] = []
        for (let i = from; i <= to; i++) {
          const it = items.current.get(i)
          if (it) ids.push(it.id)
        }
        onSelectionChange(ids)
      } else if (e.ctrlKey || e.metaKey) {
        const next = new Set(selectedSet)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        onSelectionChange([...next])
        anchorIdx.current = idx
      } else {
        onSelectionChange([item.id], item)
        anchorIdx.current = idx
      }
    },
    [select, onSelectionChange, ensureLoaded, items, selectedSet],
  )

  // Clear any lingering tooltip/preview on unmount.
  useEffect(
    () => () => {
      window.clearTimeout(tipTimer.current)
      if (showPreview) setPreview(null)
    },
    [setPreview, showPreview],
  )

  // Track the scroll area width -> number of columns (list mode is always 1).
  useEffect(() => {
    if (layout === "list") {
      setCols(1)
      return
    }
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth - GAP
      setCols(Math.max(1, Math.floor(w / (CELL + GAP))))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [layout])

  const displayTotal = total + nullOffset
  const noneSelected = (selectedIds?.length ?? 0) === 0

  // List mode = one item per row (cols is 1); grid = ceil(displayTotal / cols).
  const rowCount = Math.ceil(displayTotal / cols)
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (layout === "list" ? LIST_ROW_EST + GAP : CELL + GAP),
    overscan: 6,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const firstRow = virtualRows[0]?.index ?? 0
  const lastRow = virtualRows[virtualRows.length - 1]?.index ?? 0

  // Fetch the pages that cover the currently visible rows (searchGen retriggers
  // the fetch after a new search even when the window itself didn't move).
  useEffect(() => {
    loadVisibleRows(firstRow, lastRow, cols)
  }, [loadVisibleRows, firstRow, lastRow, cols, searchGen])

  return (
    <Flex direction="column" flex="1" minH="0">
      <style>{THUMB_CSS}</style>
      {showSearch && (
        <SearchBar
          queryInput={queryInput}
          setQueryInput={setQueryInput}
          exactness={exactness}
          setExactness={setExactness}
          runSearch={runSearch}
          total={total}
        />
      )}

      <Box
        ref={scrollRef}
        flex="1"
        minH="0"
        overflowY="auto"
        overflowX="hidden"
        onPointerOver={handlePointerOver}
        onPointerLeave={clearAll}
        onScroll={clearAll}
        onClick={select ? (e) => void handleClick(e) : undefined}
      >
        {total === 0 && !allowNull ? (
          <Flex h="full" align="center" justify="center" p="6">
            <Text fontSize="xs" color="fg.muted">
              {t("library.empty")}
            </Text>
          </Flex>
        ) : (
          <Box position="relative" width="100%" height={`${rowVirtualizer.getTotalSize()}px`}>
            {virtualRows.map((vr) =>
              layout === "list" ? (
                // One natural-size item per row, measured for dynamic height.
                <div
                  key={vr.key}
                  data-index={vr.index}
                  ref={rowVirtualizer.measureElement}
                  style={{ ...listRowStyle, transform: `translateY(${vr.start}px)` }}
                >
                  {(() => {
                    if (allowNull && vr.index === 0) return <NullCell selected={noneSelected} />
                    const idx = vr.index - nullOffset
                    const item = items.current.get(idx)
                    return (
                      <ListCell
                        idx={idx}
                        item={item}
                        color={color}
                        coloring={coloring}
                        selected={item ? selectedSet.has(item.id) : false}
                      />
                    )
                  })()}
                </div>
              ) : (
                <div
                  key={vr.key}
                  style={{ ...gridRowStyle, transform: `translateY(${vr.start}px)` }}
                >
                  {Array.from({ length: cols }, (_, c) => {
                    const displayIdx = vr.index * cols + c
                    if (displayIdx >= displayTotal) {
                      return <div key={c} style={fillerStyle} />
                    }
                    if (allowNull && displayIdx === 0) {
                      return <NullCell key="null" selected={noneSelected} />
                    }
                    const idx = displayIdx - nullOffset
                    const item = items.current.get(idx)
                    return (
                      <ThumbCell
                        key={idx}
                        idx={idx}
                        item={item}
                        color={color}
                        coloring={coloring}
                        selected={item ? selectedSet.has(item.id) : false}
                      />
                    )
                  })}
                </div>
              ),
            )}
          </Box>
        )}
      </Box>

      {tip && (
        <div style={{ ...tipStyle, left: tip.x, top: tip.y }}>
          {tip.name}
          <span style={tipArrowStyle} />
        </div>
      )}
    </Flex>
  )
}
