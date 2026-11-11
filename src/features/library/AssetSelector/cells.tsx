import { memo, useState } from "react"
import { LuBan, LuImageOff } from "react-icons/lu"
import { itemImageUrl, type LibItem, type ThumbColoring } from "../api"
import { cellStyle, imgStyle, listCellStyle, listImgStyle, nullCellStyle } from "./constants"

// -- one thumbnail cell --------------------------------------------------------

export const ThumbCell = memo(function ThumbCell({
  item,
  idx,
  color,
  coloring,
  selected,
}: {
  item?: LibItem
  idx: number
  color: string
  coloring: ThumbColoring
  selected: boolean
}) {
  const [errored, setErrored] = useState(false)
  return (
    <div
      className="bm-thumb"
      data-name={item?.name}
      data-idx={item ? idx : undefined}
      data-selected={selected ? "" : undefined}
      style={cellStyle}
    >
      {item && !errored ? (
        <img
          src={itemImageUrl(item.thumb, item.colorable, color, coloring)}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setErrored(true)}
          style={imgStyle}
        />
      ) : item ? (
        <LuImageOff color="var(--chakra-colors-icon-muted)" size={16} />
      ) : null}
    </div>
  )
})

// List-mode cell (single column, natural-size image). Same data-* delegation
// hooks as the grid cell so tooltip/preview/selection keep working.
export const ListCell = memo(function ListCell({
  item,
  idx,
  color,
  coloring,
  selected,
}: {
  item?: LibItem
  idx: number
  color: string
  coloring: ThumbColoring
  selected: boolean
}) {
  const [errored, setErrored] = useState(false)
  return (
    <div
      className="bm-thumb"
      data-name={item?.name}
      data-idx={item ? idx : undefined}
      data-selected={selected ? "" : undefined}
      style={listCellStyle}
    >
      {item && !errored ? (
        <img
          src={itemImageUrl(item.thumb, item.colorable, color, coloring)}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setErrored(true)}
          style={listImgStyle}
        />
      ) : item ? (
        <LuImageOff color="var(--chakra-colors-icon-muted)" size={16} />
      ) : null}
    </div>
  )
})

// The "no asset" cell — rendered as display slot 0 when allowNull is set.
export function NullCell({ selected }: { selected: boolean }) {
  return (
    <div
      className="bm-thumb"
      data-null=""
      data-selected={selected ? "" : undefined}
      style={nullCellStyle}
    >
      <LuBan color="var(--chakra-colors-icon-muted)" size={18} />
    </div>
  )
}
