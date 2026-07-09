import {
  memo,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react"
import {
  Box,
  Flex,
  HStack,
  Icon,
  IconButton,
  Input,
  Slider,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useTranslation } from "react-i18next"
import { LuImageOff, LuLibrary, LuX } from "react-icons/lu"
import { useLoading } from "../context/loading"
import { getLibraryItems, searchLibrary, thumbUrl, type LibItem } from "../lib/library"

const CELL = 70 // thumbnail size in px
const GAP = 8
const PAGE = 200 // items fetched per window request

// -- one thumbnail cell --------------------------------------------------------

// Static styles kept out of render so memoized cells never re-create them.
const cellStyle: CSSProperties = {
  width: CELL,
  height: CELL,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 6,
  border: "1px solid #34343c",
  background: "var(--panel-header-bg)",
  overflow: "hidden",
}
const imgStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "contain" }
const fillerStyle: CSSProperties = { width: CELL, height: CELL, flexShrink: 0 }

// Hover affordance done in CSS so cells need no per-cell handlers. Only loaded
// items (which carry data-name) get the pointer cursor + accent border.
const THUMB_CSS =
  ".od-thumb[data-name]{cursor:pointer}.od-thumb[data-name]:hover{border-color:#5aa9ff}"

// Plain-div cell, memoized so incoming page loads don't re-render already-painted
// cells. The name tooltip is handled once at the grid level via event delegation,
// so a cell is just its image (or a broken-image glyph). decoding/lazy keep image
// decode off the scroll thread.
const ThumbCell = memo(function ThumbCell({ item }: { item?: LibItem }) {
  const [errored, setErrored] = useState(false)
  return (
    <div className="od-thumb" data-name={item?.name} style={cellStyle}>
      {item && !errored ? (
        <img
          src={thumbUrl(item.thumb)}
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

// -- the "All" browser (search + virtualized grid) -----------------------------

function LibraryBrowser({ category }: { category: string }) {
  const { t } = useTranslation()
  const { withLoading } = useLoading()

  const [queryInput, setQueryInput] = useState("")
  const [exactness, setExactness] = useState(0.5)
  const exactnessRef = useRef(exactness)
  exactnessRef.current = exactness

  const [total, setTotal] = useState(0)
  // Bumped on every completed search so the page-fetch effect re-runs even when
  // total and the visible rows are unchanged (e.g. clearing/repeating a search
  // while already scrolled to the top, after items were reset).
  const [searchGen, setSearchGen] = useState(0)
  const items = useRef<Map<number, LibItem>>(new Map())
  const requestedPages = useRef<Set<number>>(new Set())
  const [, bump] = useReducer((x) => x + 1, 0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(1)

  // Single shared name tooltip driven by event delegation — avoids mounting one
  // Chakra Tooltip per cell (dozens created/destroyed per second while scrolling).
  const [tip, setTip] = useState<{ name: string; x: number; y: number } | null>(null)
  const tipTimer = useRef<number | undefined>(undefined)

  const handleGridOver = useCallback((e: ReactMouseEvent) => {
    const cell = (e.target as HTMLElement).closest?.("[data-name]") as HTMLElement | null
    window.clearTimeout(tipTimer.current)
    if (!cell) {
      setTip(null)
      return
    }
    const name = cell.dataset.name ?? ""
    const rect = cell.getBoundingClientRect()
    tipTimer.current = window.setTimeout(
      () => setTip({ name, x: rect.left + rect.width / 2, y: rect.top }),
      250,
    )
  }, [])

  const clearTip = useCallback(() => {
    window.clearTimeout(tipTimer.current)
    setTip(null)
  }, [])

  useEffect(() => () => window.clearTimeout(tipTimer.current), [])

  // Track the scroll area width -> number of columns.
  useEffect(() => {
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
  }, [])

  const runSearch = useCallback(
    (q: string) => {
      items.current.clear()
      requestedPages.current.clear()
      scrollRef.current?.scrollTo({ top: 0 })
      return withLoading(t("loading.searchingLibrary"), () =>
        searchLibrary(category, q, exactnessRef.current).then((res) => {
          setTotal(res.total)
          setSearchGen((n) => n + 1)
          bump()
        }),
      )
    },
    [category, withLoading, t],
  )

  // Fresh "all" search whenever the category changes (panel opens/switches tool).
  useEffect(() => {
    setQueryInput("")
    void runSearch("")
  }, [category, runSearch])

  const rowCount = Math.ceil(total / cols)
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CELL + GAP,
    overscan: 6,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const firstRow = virtualRows[0]?.index ?? 0
  const lastRow = virtualRows[virtualRows.length - 1]?.index ?? 0

  // Fetch the pages that cover the currently visible rows.
  useEffect(() => {
    if (total === 0) return
    const startIdx = firstRow * cols
    const endIdx = Math.min(total, (lastRow + 1) * cols)
    if (endIdx <= startIdx) return
    const firstPage = Math.floor(startIdx / PAGE)
    const lastPage = Math.floor((endIdx - 1) / PAGE)
    for (let p = firstPage; p <= lastPage; p++) {
      if (requestedPages.current.has(p)) continue
      requestedPages.current.add(p)
      getLibraryItems(p * PAGE, PAGE)
        .then((batch) => {
          batch.forEach((it, i) => items.current.set(p * PAGE + i, it))
          bump()
        })
        .catch(() => requestedPages.current.delete(p))
    }
  }, [firstRow, lastRow, cols, total, searchGen])

  return (
    <Flex direction="column" flex="1" minH="0">
      <style>{THUMB_CSS}</style>
      {/* Search + exactness controls */}
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

      {/* Virtualized grid */}
      <Box
        ref={scrollRef}
        flex="1"
        minH="0"
        overflowY="auto"
        overflowX="hidden"
        onMouseOver={handleGridOver}
        onMouseLeave={clearTip}
        onScroll={clearTip}
      >
        {total === 0 ? (
          <Flex h="full" align="center" justify="center" p="6">
            <Text fontSize="xs" color="fg.muted">
              {t("library.empty")}
            </Text>
          </Flex>
        ) : (
          <Box position="relative" width="100%" height={`${rowVirtualizer.getTotalSize()}px`}>
            {virtualRows.map((vr) => {
              const rowStart = vr.index * cols
              return (
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
                    const idx = rowStart + c
                    if (idx >= total) {
                      return <div key={c} style={fillerStyle} />
                    }
                    return <ThumbCell key={idx} item={items.current.get(idx)} />
                  })}
                </div>
              )
            })}
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

// -- the sticky Library panel --------------------------------------------------

export function LibraryPanel({ category }: { category: string }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState("all")

  return (
    <Flex
      position="absolute"
      right="0"
      top="0"
      bottom="0"
      zIndex="docked"
      w="332px"
      maxW="80%"
      direction="column"
      bg="panel.bg"
      borderLeftWidth="1px"
      borderColor="panel.border"
    >
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

      <Tabs.Root
        value={tab}
        onValueChange={(e) => setTab(e.value)}
        variant="line"
        size="sm"
        display="flex"
        flexDirection="column"
        flex="1"
        minH="0"
      >
        <Tabs.List flexShrink={0} px="2">
          <Tabs.Trigger value="all">{t("library.tabAll")}</Tabs.Trigger>
          <Tabs.Trigger value="used">{t("library.tabUsed")}</Tabs.Trigger>
          <Tabs.Trigger value="tags">{t("library.tabTags")}</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content
          value="all"
          flex="1"
          minH="0"
          p="0"
          display="flex"
          flexDirection="column"
        >
          <LibraryBrowser category={category} />
        </Tabs.Content>
        <Tabs.Content value="used" flex="1" minH="0">
          <Flex h="full" align="center" justify="center" color="fg.muted" fontSize="sm">
            {t("library.comingSoon")}
          </Flex>
        </Tabs.Content>
        <Tabs.Content value="tags" flex="1" minH="0">
          <Flex h="full" align="center" justify="center" color="fg.muted" fontSize="sm">
            {t("library.comingSoon")}
          </Flex>
        </Tabs.Content>
      </Tabs.Root>
    </Flex>
  )
}
