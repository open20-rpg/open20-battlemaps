import { type RefObject, useEffect } from "react"
import { useMapStore } from "../../../stores/mapStore"
import { useViewStore } from "../../../stores/viewStore"
import { ZOOM_LEVELS } from "../../viewport/controls"
import { type Rect } from "../model/geometry"
import { viewForRect } from "./viewport"

/**
 * The canvas's size in CSS px, kept by MapCanvas, and how much of it the
 * panels laid over its sides cover: code outside the canvas (a tool
 * "showing" something) needs both to frame a spot where it can be seen.
 */
const size = { width: 0, height: 0 }
const covers = { left: 0, right: 0 }

export function setViewportSize(width: number, height: number): void {
  size.width = width
  size.height = height
}

/** Keep `side`'s cover up to date with the width of the panel at `ref`. */
export function useViewportCover(
  ref: RefObject<HTMLElement | null>,
  side: "left" | "right",
  active = true,
): void {
  useEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const observer = new ResizeObserver(() => {
      covers[side] = el.getBoundingClientRect().width
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      covers[side] = 0
    }
  }, [ref, side, active])
}

/** Zoom and pan the view so map rect `r` fills the uncovered canvas (up to `maxZoom`), centered. */
export function focusView(r: Rect, maxZoom = 200): void {
  const map = useMapStore.getState().map
  if (!map || size.width === 0 || size.height === 0) return
  const view = viewForRect(
    r,
    size.width,
    size.height,
    map.width,
    map.height,
    ZOOM_LEVELS,
    maxZoom,
    { left: covers.left, right: covers.right },
  )
  useViewStore.getState().setZoom(view.zoom)
  useViewStore.getState().setPan(view.pan.x, view.pan.y)
}
