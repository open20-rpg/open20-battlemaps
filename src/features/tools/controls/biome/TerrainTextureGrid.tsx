import { useEffect, useRef, useState } from "react"
import { Flex, Text } from "@chakra-ui/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useTranslation } from "react-i18next"
import { useAssetSearch } from "../../../library/AssetSelector/useAssetSearch"
import { thumbUrl, type LibItem } from "../../../library/api"

const CELL = 140 // texture tile size in px
const GAP = 10
const NAME_H = 28 // room for the (up to 2-line) name under each tile
const ROW_H = CELL + NAME_H + GAP

/**
 * Virtualized 180×180 terrain-texture grid for one pack. Reuses the library's
 * windowed, `withLoading`-wrapped search engine (same efficiency as the asset
 * selector) — only visible tiles fetch and render. Clicking a tile picks it.
 */
export function TerrainTextureGrid({
  packId,
  onPick,
}: {
  packId: string
  onPick: (item: LibItem) => void
}) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(1)

  const { items, total, searchGen, loadVisibleRows } = useAssetSearch({
    browserKey: "biome-terrain-grid",
    category: "terrain",
    packId,
    allowNull: false,
    scrollRef,
  })

  // Track the scroll width -> number of columns (mirrors the asset selector).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setCols(Math.max(1, Math.floor((el.clientWidth - GAP) / (CELL + GAP))))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rowCount = Math.ceil(total / cols)
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 4,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const firstRow = virtualRows[0]?.index ?? 0
  const lastRow = virtualRows[virtualRows.length - 1]?.index ?? 0

  // Fetch the pages covering the visible rows (searchGen retriggers after a new
  // pack search even when the window itself did not move).
  useEffect(() => {
    loadVisibleRows(firstRow, lastRow, cols)
  }, [loadVisibleRows, firstRow, lastRow, cols, searchGen])

  if (searchGen > 0 && total === 0) {
    return (
      <Flex h="full" align="center" justify="center" p="6">
        <Text fontSize="sm" color="fg.muted">
          {t("library.empty")}
        </Text>
      </Flex>
    )
  }

  return (
    <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: GAP }}>
      <div style={{ position: "relative", width: "100%", height: rowVirtualizer.getTotalSize() }}>
        {virtualRows.map((vr) => (
          <div
            key={vr.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              display: "flex",
              gap: GAP,
              transform: `translateY(${vr.start}px)`,
            }}
          >
            {Array.from({ length: cols }, (_, c) => {
              const idx = vr.index * cols + c
              if (idx >= total) return <div key={c} style={{ width: CELL }} />
              const item = items.current.get(idx)
              return (
                <Flex
                  as="button"
                  key={c}
                  direction="column"
                  align="center"
                  gap="1"
                  w={`${CELL}px`}
                  onClick={() => item && onPick(item)}
                >
                  <Flex
                    boxSize={`${CELL}px`}
                    align="center"
                    justify="center"
                    borderWidth="1px"
                    borderColor="panel.border"
                    borderRadius="md"
                    overflow="hidden"
                    bg="panel.header"
                    _hover={{ borderColor: "brand.fg" }}
                  >
                    {item && (
                      <img
                        src={thumbUrl(item.thumb)}
                        alt=""
                        draggable={false}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    )}
                  </Flex>
                  <Text
                    fontSize="xs"
                    color="fg.muted"
                    lineClamp={2}
                    textAlign="center"
                    h={`${NAME_H}px`}
                  >
                    {item?.name ?? ""}
                  </Text>
                </Flex>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
