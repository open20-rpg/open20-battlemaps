import type { CSSProperties } from "react"

export const CELL = 64 // thumbnail size in px (matches the 64x64 thumbnails)
export const GAP = 8
export const LIST_ROW_EST = 40 // avg natural thumb height, used to estimate list scroll

// Categories whose thumbnails vary in size (wall/path strips) are shown as a
// single column at natural size instead of the fixed square grid.
export const LIST_CATEGORIES = new Set(["walls", "paths"])

// Categories Dungeondraft tints by the chosen color (multiplied), unless the
// asset is colorable (its red regions take the color instead).
export const TINTED_CATEGORIES = new Set(["walls", "tilesets"])

export const cellStyle: CSSProperties = {
  position: "relative",
  width: CELL,
  height: CELL,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
}
export const imgStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "contain" }
export const fillerStyle: CSSProperties = { width: CELL, height: CELL, flexShrink: 0 }

// List-mode cell: image at natural size, capped to the column width.
export const listCellStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: LIST_ROW_EST,
  overflow: "hidden",
}
export const listImgStyle: CSSProperties = {
  maxWidth: "100%",
  height: "auto",
  objectFit: "contain",
}

// "No asset" cell (dashed empty square), used when allowNull is set.
export const nullCellStyle: CSSProperties = {
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
export const THUMB_CSS =
  ".bm-thumb[data-name]{cursor:pointer}" +
  ".bm-thumb[data-selected]{outline:2px solid #e0534e;outline-offset:-2px;border-radius:6px;background:#3a1a1c}"

// Positioned wrappers for the virtualized rows; the per-row translateY is the
// only dynamic bit and is merged inline where they're used.
export const listRowStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  padding: `0 ${GAP}px ${GAP}px`,
}
export const gridRowStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  display: "flex",
  padding: `0 ${GAP}px`,
  gap: `${GAP}px`,
}

// Shared name tooltip; left/top follow the hovered cell and are merged inline.
export const tipStyle: CSSProperties = {
  position: "fixed",
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
}
export const tipArrowStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: -4,
  width: 8,
  height: 8,
  transform: "translateX(-50%) rotate(45deg)",
  background: "#212126",
  borderRight: "1px solid #34343c",
  borderBottom: "1px solid #34343c",
}

// Badge on colorable items (a dropper, as Dungeondraft marks them): over the
// thumbnail's top-left corner, so it never hides much of it.
export const COLORABLE_BADGE_PX = 16
export const colorableBadgeStyle: CSSProperties = {
  position: "absolute",
  top: 1,
  left: 1,
  width: COLORABLE_BADGE_PX,
  height: COLORABLE_BADGE_PX,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "50%",
  background: "var(--chakra-colors-panel-solid)",
  border: "1px solid var(--chakra-colors-panel-border)",
  color: "var(--chakra-colors-menubar-fg)",
  pointerEvents: "none",
}
