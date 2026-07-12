import { useEffect, type RefObject } from "react"
import { useViewStore } from "../../../stores/viewStore"
import { ZOOM_LEVELS } from "../../viewport/controls"
import { clampZoom } from "./viewport"

interface Point {
  x: number
  y: number
}

/** Live pointer position by id, used to track an active two-finger gesture. */
type PointerMap = Map<number, Point>

function midpoint(points: Point[]): Point {
  return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
}

function distance(points: Point[]): number {
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
}

/** Step `zoom` one ZOOM_LEVELS notch up (`dir` > 0) or down (`dir` < 0). */
function stepZoom(zoom: number, dir: 1 | -1): number {
  let closest = 0
  for (let i = 1; i < ZOOM_LEVELS.length; i++) {
    if (Math.abs(ZOOM_LEVELS[i] - zoom) < Math.abs(ZOOM_LEVELS[closest] - zoom)) closest = i
  }
  const next = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, closest + dir))
  return ZOOM_LEVELS[next]
}

/**
 * Wires up viewport gestures on `ref`'s element:
 *  - Pan: middle-mouse drag, or a two-finger touch drag.
 *  - Zoom: Ctrl+scroll (also how browsers report a trackpad pinch), stepping
 *    through the same ZOOM_LEVELS as the zoom selector; and touch pinch
 *    (continuous), combined with a two-finger drag panning at the same time.
 * Panning writes raw deltas into the view store; MapCanvas's world-transform
 * effect clamps and corrects it every render so the map can never be panned
 * fully off-screen.
 */
export function useViewportGestures(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const current = useViewStore.getState().zoom
      useViewStore.getState().setZoom(stepZoom(current, e.deltaY < 0 ? 1 : -1))
    }

    let middlePanning = false
    let lastPoint: Point | null = null

    const pointers: PointerMap = new Map()
    let touchGesture: { dist: number; mid: Point; zoom: number; panX: number; panY: number } | null =
      null

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1) {
        e.preventDefault()
        middlePanning = true
        lastPoint = { x: e.clientX, y: e.clientY }
        el.setPointerCapture(e.pointerId)
        return
      }
      if (e.pointerType !== "touch") return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      el.setPointerCapture(e.pointerId)
      if (pointers.size === 2) {
        const pts = [...pointers.values()]
        const { zoom, panX, panY } = useViewStore.getState()
        touchGesture = { dist: distance(pts), mid: midpoint(pts), zoom, panX, panY }
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (middlePanning && lastPoint) {
        const dx = e.clientX - lastPoint.x
        const dy = e.clientY - lastPoint.y
        lastPoint = { x: e.clientX, y: e.clientY }
        const s = useViewStore.getState()
        s.setPan(s.panX + dx, s.panY + dy)
        return
      }
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size !== 2 || !touchGesture) return
      const pts = [...pointers.values()]
      const dist = distance(pts)
      const mid = midpoint(pts)
      useViewStore.getState().setZoom(clampZoom(Math.round(touchGesture.zoom * (dist / touchGesture.dist))))
      useViewStore
        .getState()
        .setPan(touchGesture.panX + (mid.x - touchGesture.mid.x), touchGesture.panY + (mid.y - touchGesture.mid.y))
    }

    const onPointerEnd = (e: PointerEvent) => {
      if (e.button === 1) middlePanning = false
      pointers.delete(e.pointerId)
      if (pointers.size < 2) touchGesture = null
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    el.addEventListener("pointerdown", onPointerDown)
    el.addEventListener("pointermove", onPointerMove)
    el.addEventListener("pointerup", onPointerEnd)
    el.addEventListener("pointercancel", onPointerEnd)
    return () => {
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("pointerdown", onPointerDown)
      el.removeEventListener("pointermove", onPointerMove)
      el.removeEventListener("pointerup", onPointerEnd)
      el.removeEventListener("pointercancel", onPointerEnd)
    }
  }, [ref])
}
