import { CELL, GAP } from "./AssetSelector/constants"

/** Thumbnail columns the docked Library can be widened to (the narrowest is its default). */
export const LIBRARY_MIN_COLUMNS = 4
export const LIBRARY_MAX_COLUMNS = 8

/**
 * Everything around the grid's columns: its outer gap, the panel's border
 * and the scrollbar, with some room to spare (the 4-column panel stays the
 * 332 px it always was).
 */
const CHROME = 36

const clampColumns = (n: number) =>
  Math.min(LIBRARY_MAX_COLUMNS, Math.max(LIBRARY_MIN_COLUMNS, Math.round(n)))

/** The docked Library's width (px) that fits `columns` thumbnails exactly. */
export function libraryWidth(columns: number): number {
  return clampColumns(columns) * (CELL + GAP) + GAP + CHROME
}

/** The column count whose width is nearest `width` px (what a drag snaps to). */
export function libraryColumnsFor(width: number): number {
  return clampColumns((width - GAP - CHROME) / (CELL + GAP))
}
