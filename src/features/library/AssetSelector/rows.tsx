import { type VirtualItem } from "@tanstack/react-virtual"
import { type LibItem, type ThumbColoring } from "../api"
import { ListCell, NullCell, ThumbCell } from "./cells"
import { fillerStyle, gridRowStyle, listRowStyle } from "./constants"

/**
 * The virtualizer's visible rows: one natural-size item per row in list
 * layout (measured), `cols` thumbnails per row in grid layout. The null
 * cell, when allowed, takes display slot 0.
 */
export function AssetRows({
  rows,
  measureElement,
  layout,
  cols,
  displayTotal,
  allowNull,
  nullOffset,
  noneSelected,
  items,
  color,
  coloring,
  selectedSet,
}: {
  rows: VirtualItem[]
  measureElement: (el: Element | null) => void
  layout: "list" | "grid"
  cols: number
  displayTotal: number
  allowNull: boolean
  nullOffset: number
  noneSelected: boolean
  /** Sparse index → item map (pages arrive as they're fetched). */
  items: ReadonlyMap<number, LibItem>
  color: string
  coloring: ThumbColoring
  selectedSet: ReadonlySet<string>
}) {
  return rows.map((vr) =>
    layout === "list" ? (
      // One natural-size item per row, measured for dynamic height.
      <div
        key={vr.key}
        data-index={vr.index}
        ref={measureElement}
        style={{ ...listRowStyle, transform: `translateY(${vr.start}px)` }}
      >
        {(() => {
          if (allowNull && vr.index === 0) return <NullCell selected={noneSelected} />
          const idx = vr.index - nullOffset
          const item = items.get(idx)
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
      <div key={vr.key} style={{ ...gridRowStyle, transform: `translateY(${vr.start}px)` }}>
        {Array.from({ length: cols }, (_, c) => {
          const displayIdx = vr.index * cols + c
          if (displayIdx >= displayTotal) {
            return <div key={c} style={fillerStyle} />
          }
          if (allowNull && displayIdx === 0) {
            return <NullCell key="null" selected={noneSelected} />
          }
          const idx = displayIdx - nullOffset
          const item = items.get(idx)
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
  )
}
