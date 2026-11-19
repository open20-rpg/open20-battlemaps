import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { fineValueAt, leftSpot, STILL_MS, valueAt, wentUp, type SliderRange } from "../lib/fineDrag"

/** Where the finger is and whether the precise mode is on, for the value bubble. */
export interface FineSliderTouch {
  x: number
  y: number
  fine: boolean
}

interface Drag {
  id: number
  startY: number
  track: { left: number; width: number }
  value: number
  last: { x: number; y: number }
  /** Where the finger rests; still there for STILL_MS, the precise mode starts. */
  spot: { x: number; y: number }
  timer: ReturnType<typeof setTimeout> | undefined
  anchor: { x: number; value: number } | null
}

/**
 * A slider's touch and pen drags, with the precise mode of lib/fineDrag
 * (going up, or resting the finger, slows the value down to a tenth). The
 * mouse is left to the slider itself. Spread `handlers` on an element
 * around the slider: it takes the touch before the slider sees it.
 */
export function useFineSlider(
  range: SliderRange,
  value: number,
  onChange: (value: number) => void,
) {
  const drag = useRef<Drag | null>(null)
  const [touch, setTouch] = useState<FineSliderTouch | null>(null)
  // Let a pending timer go with the control.
  useEffect(() => () => clearTimeout(drag.current?.timer), [])

  const set = (d: Drag, next: number) => {
    if (next === d.value) return
    d.value = next
    onChange(next)
  }
  const goFine = (d: Drag) => {
    if (d.anchor) return
    clearTimeout(d.timer)
    d.anchor = { x: d.last.x, value: d.value }
    navigator.vibrate?.(10)
    setTouch({ ...d.last, fine: true })
  }
  const rest = (d: Drag) => {
    clearTimeout(d.timer)
    d.spot = d.last
    d.timer = setTimeout(() => goFine(d), STILL_MS)
  }
  const end = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    clearTimeout(d.timer)
    drag.current = null
    setTouch(null)
  }

  const handlers = {
    onPointerDownCapture: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" || e.button !== 0) return
      // Only a press on the slider itself (not its label).
      const root = e.currentTarget.querySelector('[data-part="root"]')
      const control = root?.querySelector('[data-part="control"]')
      if (!control || !root?.contains(e.target as Node)) return
      // Ours, not the slider's: it would follow the finger to the pixel.
      e.stopPropagation()
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const rect = control.getBoundingClientRect()
      const p = { x: e.clientX, y: e.clientY }
      const d: Drag = {
        id: e.pointerId,
        startY: p.y,
        track: { left: rect.left, width: rect.width },
        value,
        last: p,
        spot: p,
        timer: undefined,
        anchor: null,
      }
      drag.current = d
      set(d, valueAt(p.x, d.track, range))
      rest(d)
      setTouch({ ...p, fine: false })
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      d.last = { x: e.clientX, y: e.clientY }
      if (!d.anchor && wentUp(d.startY, d.last.y)) goFine(d)
      else if (!d.anchor && leftSpot(d.spot, d.last)) rest(d)
      set(
        d,
        d.anchor
          ? fineValueAt(d.last.x, d.anchor, d.track.width, range)
          : valueAt(d.last.x, d.track, range),
      )
      setTouch({ ...d.last, fine: !!d.anchor })
    },
    onPointerUp: end,
    onPointerCancel: end,
  }
  return { handlers, touch }
}
