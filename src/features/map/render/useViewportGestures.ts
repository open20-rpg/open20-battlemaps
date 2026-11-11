import { useEffect, type RefObject } from "react"
import { useViewStore } from "../../../stores/viewStore"
import { ZOOM_LEVELS } from "../../viewport/controls"
import { useMapStore } from "../../../stores/mapStore"
import { clampZoom, panToPlace, screenToMap } from "./viewport"
import { currentBindings } from "../../shortcuts/bindings"
import { isHeld } from "../../shortcuts/held"

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
 *  - Pan: the pan shortcut (middle-mouse drag, or a left drag while Space is
 *    held, by default), or a two-finger touch drag (one finger is the
 *    tool's; fingers are ignored while a pen is down: the palm).
 *  - Zoom: Ctrl+scroll (also how browsers report a trackpad pinch), stepping
 *    through the same ZOOM_LEVELS as the zoom selector, centered on the
 *    cursor; and touch pinch (continuous) centered between the fingers,
 *    combined with a two-finger drag panning at the same time.
 * Panning writes raw deltas into the view store; MapCanvas's world-transform
 * effect clamps and corrects it every render so the map can never be panned
 * fully off-screen.
 */
export function useViewportGestures(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    /** Container px of a client point. */
    const local = (x: number, y: number): Point => {
      const rect = el.getBoundingClientRect()
      return { x: x - rect.left, y: y - rect.top }
    }
    /** Zoom to `zoom` keeping the map point under `screen` (container px) where it is. */
    const zoomAt = (screen: Point, zoom: number) => {
      const map = useMapStore.getState().map
      const view = useViewStore.getState()
      if (!map) return view.setZoom(zoom)
      const { width, height } = el.getBoundingClientRect()
      const pan = { x: view.panX, y: view.panY }
      const p = screenToMap(screen, width, height, map.width, map.height, view.zoom, pan)
      const next = panToPlace(p, screen, width, height, map.width, map.height, zoom)
      view.setZoom(zoom)
      view.setPan(next.x, next.y)
    }

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const current = useViewStore.getState().zoom
      zoomAt(local(e.clientX, e.clientY), stepZoom(current, e.deltaY < 0 ? 1 : -1))
    }

    let middlePanning = false
    let lastPoint: Point | null = null

    const pointers: PointerMap = new Map()
    let touchGesture: {
      dist: number
      zoom: number
      /** The map point between the fingers when the pinch started (it follows them). */
      anchor: Point | null
    } | null = null

    /** A pen is down: fingers on the screen are the palm resting, not a pinch. */
    let penDown = false

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "pen") {
        penDown = true
        pointers.clear()
        touchGesture = null
      }
      // Pan: the middle button (if bound) or a left drag while the pan key is held.
      const panning =
        (e.button === 1 && currentBindings().pan?.includes("MouseMiddle")) ||
        (e.button === 0 && isHeld("pan"))
      if (panning) {
        e.preventDefault()
        middlePanning = true
        lastPoint = { x: e.clientX, y: e.clientY }
        el.setPointerCapture(e.pointerId)
        return
      }
      if (e.pointerType !== "touch" || penDown) return
      // The first finger of a new touch: no other can still be down.
      if (e.isPrimary) {
        pointers.clear()
        touchGesture = null
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      el.setPointerCapture(e.pointerId)
      if (pointers.size === 2) {
        const pts = [...pointers.values()]
        const { zoom, panX, panY } = useViewStore.getState()
        const map = useMapStore.getState().map
        const { width, height } = el.getBoundingClientRect()
        const mid = midpoint(pts)
        const anchor = map
          ? screenToMap(local(mid.x, mid.y), width, height, map.width, map.height, zoom, {
              x: panX,
              y: panY,
            })
          : null
        touchGesture = { dist: distance(pts), zoom, anchor }
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
      const mid = midpoint(pts)
      const zoom = clampZoom(Math.round(touchGesture.zoom * (distance(pts) / touchGesture.dist)))
      const map = useMapStore.getState().map
      useViewStore.getState().setZoom(zoom)
      // Pinch zooms around the fingers and drags with them: the map point that
      // was between them stays between them.
      if (map && touchGesture.anchor) {
        const { width, height } = el.getBoundingClientRect()
        const screen = local(mid.x, mid.y)
        const pan = panToPlace(
          touchGesture.anchor,
          screen,
          width,
          height,
          map.width,
          map.height,
          zoom,
        )
        useViewStore.getState().setPan(pan.x, pan.y)
      }
    }

    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType === "pen") penDown = false
      if (middlePanning && (e.button === 1 || e.button === 0)) middlePanning = false
      pointers.delete(e.pointerId)
      if (pointers.size < 2) touchGesture = null
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    el.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("pointermove", onPointerMove)
    // Moves and lifts are heard on the window: the tool input captures the
    // pointer on the editor around this element, so they may never reach
    // it — and a finger left behind would make every later pinch count three.
    window.addEventListener("pointerup", onPointerEnd)
    window.addEventListener("pointercancel", onPointerEnd)
    return () => {
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerEnd)
      window.removeEventListener("pointercancel", onPointerEnd)
    }
  }, [ref])
}
