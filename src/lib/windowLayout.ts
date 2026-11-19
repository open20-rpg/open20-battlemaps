/** Size and position (px) of a floating window. */
export interface WindowRect {
  x: number
  y: number
  w: number
  h: number
}

/** Space kept between a floating window and the viewport's edges. */
export const WINDOW_MARGIN = 8

/**
 * Where a floating window opens: its preferred size, shrunk to fit the
 * viewport (never under `min`, unless the viewport itself is smaller), at
 * `at` when given or else centered — always wholly on screen.
 */
export function openingRect(
  viewport: { w: number; h: number },
  size: { w: number; h: number },
  min: { w: number; h: number },
  at?: { x: number; y: number },
): WindowRect {
  const room = {
    w: Math.max(0, viewport.w - 2 * WINDOW_MARGIN),
    h: Math.max(0, viewport.h - 2 * WINDOW_MARGIN),
  }
  const w = Math.min(room.w, Math.max(Math.min(min.w, room.w), size.w))
  const h = Math.min(room.h, Math.max(Math.min(min.h, room.h), size.h))
  const x = at ? at.x : (viewport.w - w) / 2
  const y = at ? at.y : (viewport.h - h) / 2
  return keepOnScreen(viewport, { x, y, w, h })
}

/** `rect` moved (and if need be shrunk) so it's wholly inside the viewport. */
export function keepOnScreen(viewport: { w: number; h: number }, rect: WindowRect): WindowRect {
  const w = Math.min(rect.w, Math.max(0, viewport.w - 2 * WINDOW_MARGIN))
  const h = Math.min(rect.h, Math.max(0, viewport.h - 2 * WINDOW_MARGIN))
  const clamp = (v: number, size: number, total: number) =>
    Math.max(WINDOW_MARGIN, Math.min(total - size - WINDOW_MARGIN, v))
  return { x: clamp(rect.x, w, viewport.w), y: clamp(rect.y, h, viewport.h), w, h }
}
