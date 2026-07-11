import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { Box, Flex, HStack, IconButton, Input, Slider, Text, VStack } from "@chakra-ui/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useTranslation } from "react-i18next"
import { LuBan, LuImageOff, LuX } from "react-icons/lu"
import { withLoading } from "../../stores/loadingStore"
import { usePreviewStore } from "../../stores/previewStore"
import {
  getLibraryItems,
  itemImageUrl,
  releaseLibrarySearch,
  searchLibrary,
  type LibItem,
} from "./api"

const CELL = 64 // thumbnail size in px (matches the 64x64 thumbnails)
const GAP = 8
const PAGE = 200 // items fetched per window request
const LIST_ROW_EST = 40 // avg natural thumb height, used to estimate list scroll

// Categories whose thumbnails vary in size (wall/path strips) are shown as a
// single column at natural size instead of the fixed square grid.
const LIST_CATEGORIES = new Set(["walls", "paths"])

// -- one thumbnail cell --------------------------------------------------------

const cellStyle: CSSProperties = {
  width: CELL,
  height: CELL,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
}
const imgStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "contain" }
const fillerStyle: CSSProperties = { width: CELL, height: CELL, flexShrink: 0 }

// List-mode cell: image at natural size, capped to the column width.
const listCellStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: LIST_ROW_EST,
  overflow: "hidden",
}
const listImgStyle: CSSProperties = { maxWidth: "100%", height: "auto", objectFit: "contain" }

// "No asset" cell (dashed empty square), used when allowNull is set.
const nullCellStyle: CSSProperties = {
  width: CELL,
  height: CELL,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px dashed #55555f",
  borderRadius: 6,
  cursor: "pointer",
}

// Loaded items get the pointer cursor; the selected one gets a highlight ring.
const THUMB_CSS =
  ".od-thumb[data-name]{cursor:pointer}" +
  ".od-thumb[data-selected]{outline:2px solid #5aa9ff;outline-offset:-2px;border-radius:6px;background:#26364f}"

const ThumbCell = memo(function ThumbCell({
  item,
  idx,
  color,
  selected,
}: {
  item?: LibItem
  idx: number
  color: string
  selected: boolean
}) {
  const [errored, setErrored] = useState(false)
  return (
    <div
      className="od-thumb"
      data-name={item?.name}
      data-idx={item ? idx : undefined}
      data-selected={selected ? "" : undefined}
      style={cellStyle}
    >
      {item && !errored ? (
        <img
          src={itemImageUrl(item.thumb, item.colorable, color)}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setErrored(true)}
          style={imgStyle}
        />
      ) : item ? (
        <LuImageOff color="#8a8a90" size={16} />
      ) : null}
    </div>
  )
})

// List-mode cell (single column, natural-size image). Same data-* delegation
// hooks as the grid cell so tooltip/preview/selection keep working.
const ListCell = memo(function ListCell({
  item,
  idx,
  color,
  selected,
}: {
  item?: LibItem
  idx: number
  color: string
  selected: boolean
}) {
  const [errored, setErrored] = useState(false)
  return (
    <div
      className="od-thumb"
      data-name={item?.name}
      data-idx={item ? idx : undefined}
      data-selected={selected ? "" : undefined}
      style={listCellStyle}
    >
      {item && !errored ? (
        <img
          src={itemImageUrl(item.thumb, item.colorable, color)}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setErrored(true)}
          style={listImgStyle}
        />
      ) : item ? (
        <LuImageOff color="#8a8a90" size={16} />
      ) : null}
    </div>
  )
})

// The "no asset" cell — rendered as display slot 0 when allowNull is set.
function NullCell({ selected }: { selected: boolean }) {
  return (
    <div
      className="od-thumb"
      data-null=""
      data-selected={selected ? "" : undefined}
      style={nullCellStyle}
    >
      <LuBan color="#8a8a90" size={18} />
    </div>
  )
}

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
  onSelectionChange?: (ids: string[]) => void
  /** Drive the shared hover/press preview panel (used by the Library). */
  showPreview?: boolean
  /** Show the search box + exactness slider (hidden for param pickers). */
  showSearch?: boolean
  /** Show an empty first cell that selects "no asset" (empty selection). */
  allowNull?: boolean
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
}: AssetSelectorProps) {
  const { t } = useTranslation()
  
  const [queryInput, setQueryInput] = useState("")
  const [exactness, setExactness] = useState(0.5)
  const exactnessRef = useRef(exactness)
  exactnessRef.current = exactness

  const [total, setTotal] = useState(0)
  const [searchGen, setSearchGen] = useState(0)
  const items = useRef<Map<number, LibItem>>(new Map())
  const requestedPages = useRef<Set<number>>(new Set())
  const [tick, bump] = useReducer((x) => x + 1, 0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(1)
  // Wall/path thumbs vary in size -> single-column list at natural size.
  const layout = LIST_CATEGORIES.has(category) ? "list" : "grid"

  const selectedSet = useMemo(() => new Set(selectedIds ?? []), [selectedIds])
  const selectedRef = useRef(selectedSet)
  selectedRef.current = selectedSet
  // Anchor for shift-range selection.
  const anchorIdx = useRef<number | null>(null)

  // Shared name tooltip via event delegation (see LibraryPanel history).
  const [tip, setTip] = useState<{ name: string; x: number; y: number } | null>(null)
  const tipTimer = useRef<number | undefined>(undefined)

  const colorRef = useRef(color)
  colorRef.current = color

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
                thumbUrl: itemImageUrl(item.thumb, item.colorable, colorRef.current),
                fullUrl: itemImageUrl(item.full, item.colorable, colorRef.current),
              }
            : null,
        )
      }
    },
    [setPreview, showPreview],
  )

  const clearAll = useCallback(() => {
    window.clearTimeout(tipTimer.current)
    setTip(null)
    if (showPreview) {
      previewIdx.current = null
      setPreview(null)
    }
  }, [setPreview, showPreview])

  // Ensure every index in [from, to] is loaded (used by shift-range selection).
  const ensureLoaded = useCallback(
    async (from: number, to: number) => {
      const first = Math.floor(from / PAGE)
      const last = Math.floor(to / PAGE)
      const jobs: Promise<void>[] = []
      for (let p = first; p <= last; p++) {
        if (items.current.has(p * PAGE)) continue
        jobs.push(
          getLibraryItems(browserKey, p * PAGE, PAGE).then((batch) => {
            batch.forEach((it, i) => items.current.set(p * PAGE + i, it))
          }),
        )
      }
      if (jobs.length) await Promise.all(jobs)
    },
    [browserKey],
  )

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
        onSelectionChange([item.id])
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
        const next = new Set(selectedRef.current)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        onSelectionChange([...next])
        anchorIdx.current = idx
      } else {
        onSelectionChange([item.id])
        anchorIdx.current = idx
      }
    },
    [select, onSelectionChange, ensureLoaded],
  )

  // Release the backend cache and clear any lingering preview on unmount.
  useEffect(
    () => () => {
      window.clearTimeout(tipTimer.current)
      if (showPreview) setPreview(null)
      void releaseLibrarySearch(browserKey)
    },
    [browserKey, setPreview, showPreview],
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

  const runSearch = useCallback(
    (q: string) => {
      items.current.clear()
      requestedPages.current.clear()
      scrollRef.current?.scrollTo({ top: 0 })
      return withLoading(t("loading.searchingLibrary"), () =>
        searchLibrary(browserKey, category, q, exactnessRef.current).then((res) => {
          setTotal(res.total)
          setSearchGen((n) => n + 1)
          bump()
        }),
      )
    },
    [browserKey, category, t],
  )

  // Fresh "all" search whenever the category changes (panel opens/switches).
  useEffect(() => {
    setQueryInput("")
    void runSearch("")
  }, [category, runSearch])

  // The null option occupies display slot 0; real items shift up by one.
  const nullOffset = allowNull ? 1 : 0
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

  // Fetch the pages that cover the currently visible rows.
  useEffect(() => {
    if (total === 0) return
    // Map the visible display range back to real item indices (minus the null slot).
    const startIdx = Math.max(0, firstRow * cols - nullOffset)
    const endIdx = Math.min(total, (lastRow + 1) * cols - nullOffset)
    if (endIdx <= startIdx) return
    const firstPage = Math.floor(startIdx / PAGE)
    const lastPage = Math.floor((endIdx - 1) / PAGE)
    for (let p = firstPage; p <= lastPage; p++) {
      if (requestedPages.current.has(p)) continue
      requestedPages.current.add(p)
      getLibraryItems(browserKey, p * PAGE, PAGE)
        .then((batch) => {
          batch.forEach((it, i) => items.current.set(p * PAGE + i, it))
          bump()
        })
        .catch(() => requestedPages.current.delete(p))
    }
  }, [firstRow, lastRow, cols, total, searchGen, browserKey, nullOffset])

  // Single-select must always hold one item: when nothing is selected, default
  // to the first result once it has loaded (runs again if the first page loads
  // after mount, via `tick`). Skipped when null is allowed (empty is valid).
  useEffect(() => {
    if (select !== "single" || allowNull || !onSelectionChange) return
    if ((selectedIds?.length ?? 0) > 0 || total === 0) return
    const first = items.current.get(0)
    if (first) onSelectionChange([first.id])
  }, [select, allowNull, onSelectionChange, selectedIds, total, tick])

  return (
    <Flex direction="column" flex="1" minH="0">
      <style>{THUMB_CSS}</style>
      {showSearch && (
        <VStack align="stretch" gap="2.5" p="3" borderBottomWidth="1px" borderColor="panel.border">
          <HStack gap="1.5">
            <Input
              size="sm"
              value={queryInput}
              placeholder={t("library.searchPlaceholder")}
              onChange={(e) => setQueryInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch(queryInput)
              }}
            />
            <IconButton
              aria-label={t("library.clear")}
              size="sm"
              variant="subtle"
              onClick={() => {
                setQueryInput("")
                void runSearch("")
              }}
            >
              <LuX />
            </IconButton>
          </HStack>
          <HStack gap="2.5" fontSize="2xs" color="fg.muted">
            <Text flexShrink={0}>{t("library.fuzzy")}</Text>
            <Slider.Root
              flex="1"
              size="sm"
              colorPalette="blue"
              min={0}
              max={100}
              step={1}
              value={[Math.round(exactness * 100)]}
              onValueChange={(e) => setExactness(e.value[0] / 100)}
            >
              <Slider.Control>
                <Slider.Track>
                  <Slider.Range />
                </Slider.Track>
                <Slider.Thumb index={0}>
                  <Slider.HiddenInput />
                </Slider.Thumb>
              </Slider.Control>
            </Slider.Root>
            <Text flexShrink={0}>{t("library.exact")}</Text>
          </HStack>
          <Text fontSize="2xs" color="fg.muted">
            {t("library.results", { count: total })}
          </Text>
        </VStack>
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
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    padding: `0 ${GAP}px ${GAP}px`,
                    transform: `translateY(${vr.start}px)`,
                  }}
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
                        selected={item ? selectedSet.has(item.id) : false}
                      />
                    )
                  })()}
                </div>
              ) : (
                <div
                  key={vr.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    display: "flex",
                    padding: `0 ${GAP}px`,
                    gap: `${GAP}px`,
                    transform: `translateY(${vr.start}px)`,
                  }}
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
        <div
          style={{
            position: "fixed",
            left: tip.x,
            top: tip.y,
            transform: "translate(-50%, calc(-100% - 8px))",
            pointerEvents: "none",
            zIndex: 2000,
            maxWidth: 280,
            padding: "4px 8px",
            borderRadius: 6,
            background: "#212126",
            border: "1px solid #34343c",
            color: "#e7e7ea",
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          {tip.name}
          <span
            style={{
              position: "absolute",
              left: "50%",
              bottom: -4,
              width: 8,
              height: 8,
              transform: "translateX(-50%) rotate(45deg)",
              background: "#212126",
              borderRight: "1px solid #34343c",
              borderBottom: "1px solid #34343c",
            }}
          />
        </div>
      )}
    </Flex>
  )
}
