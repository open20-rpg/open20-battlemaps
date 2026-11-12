/**
 * Whether the view is being moved by a gesture (pinch, two-finger or
 * middle-button pan, wheel zoom). Meanwhile the canvas shows a snapshot of
 * the map moved and scaled with the view instead of redrawing everything
 * every frame (MapCanvas); the real redraw happens once it ends.
 */

type Listener = (active: boolean) => void

let count = 0
const listeners = new Set<Listener>()

export const viewGestureActive = (): boolean => count > 0

export function beginViewGesture(): void {
  count++
  if (count === 1) for (const l of listeners) l(true)
}

export function endViewGesture(): void {
  if (count === 0) return
  count--
  if (count === 0) for (const l of listeners) l(false)
}

export function subscribeViewGesture(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
