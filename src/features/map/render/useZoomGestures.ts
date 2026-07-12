import { useEffect, type RefObject } from "react"
import { useViewStore } from "../../../stores/viewStore"
import { clampZoom } from "./viewport"

/** Live pointer position by id, used to track an active two-finger pinch. */
type PointerMap = Map<number, { x: number; y: number }>

function pinchDistance(pointers: PointerMap): number | null {
  if (pointers.size < 2) return null
  const [a, b] = [...pointers.values()]
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Wires up zoom gestures on `ref`'s element: Ctrl+scroll (which is also how
 * browsers report a trackpad pinch) and touch pinch-to-zoom. Both adjust the
 * view store's zoom directly; the map recenters itself every render since
 * there's no pan state yet.
 */
export function useZoomGestures(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.01)
      const current = useViewStore.getState().zoom
      useViewStore.getState().setZoom(clampZoom(Math.round(current * factor)))
    }

    const pointers: PointerMap = new Map()
    let pinchStartDist: number | null = null
    let pinchStartZoom = 100

    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        pinchStartDist = pinchDistance(pointers)
        pinchStartZoom = useViewStore.getState().zoom
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size !== 2 || !pinchStartDist) return
      const dist = pinchDistance(pointers)
      if (!dist) return
      useViewStore.getState().setZoom(clampZoom(Math.round(pinchStartZoom * (dist / pinchStartDist))))
    }

    const onPointerEnd = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchStartDist = null
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
