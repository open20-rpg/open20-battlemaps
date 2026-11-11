import { type IconType } from "react-icons"
import { LuEclipse, LuGrid3X3, LuLightbulb, LuMagnet, LuSearch } from "react-icons/lu"
import { type Shortcut } from "../../lib/shortcuts"
import { type ViewToggleKey } from "../../stores/viewStore"

/**
 * View controls shown at the bottom of the left bar. Unlike tools these are
 * one-off, custom widgets, but they still come from a single data-driven list
 * so adding or reordering one is just editing this array — no JSX changes.
 *
 * Each entry declares its `kind`; the ViewControlsBar renders the matching
 * widget. Array order is on-screen order, top to bottom.
 */

/** An on/off view overlay bound to a boolean in the view store. */
export interface ToggleControl {
  kind: "toggle"
  id: string
  nameKey: string
  icon: IconType
  /** Which boolean in the view store this button flips. */
  key: ViewToggleKey
  shortcut?: Shortcut
}

/** The zoom-level selector; shows the current zoom and opens a level menu. */
export interface ZoomControl {
  kind: "zoom"
  id: string
  nameKey: string
  icon: IconType
}

export type ViewControl = ToggleControl | ZoomControl

/** Selectable zoom percentages, ascending. Always displayed with a "%". */
export const ZOOM_LEVELS = [10, 12, 15, 25, 33, 50, 75, 100, 125, 150, 200, 250, 300, 400, 600, 800]

export const VIEW_CONTROLS: ViewControl[] = [
  {
    kind: "toggle",
    id: "grid",
    nameKey: "view.grid",
    icon: LuGrid3X3,
    key: "grid",
    shortcut: { key: "g", shift: true },
  },
  {
    kind: "toggle",
    id: "snap",
    nameKey: "view.snap",
    icon: LuMagnet,
    key: "snap",
    shortcut: { key: "s", shift: true },
  },
  {
    kind: "toggle",
    id: "lighting",
    nameKey: "view.lighting",
    icon: LuLightbulb,
    key: "lighting",
    shortcut: { key: "l", shift: true },
  },
  {
    kind: "toggle",
    id: "shadows",
    nameKey: "view.shadows",
    icon: LuEclipse,
    key: "shadows",
    shortcut: { key: "h", shift: true },
  },
  { kind: "zoom", id: "zoom", nameKey: "view.zoom", icon: LuSearch },
]
