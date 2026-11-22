import { type Vec2 } from "@open20/battlemaps-sdk"
import { useEditorStore } from "../../stores/editorStore"
import { useMapStore } from "../../stores/mapStore"
import { contributionsOf } from "../../stores/extensionsStore"
import { setSnapOverride } from "../tools/behaviors/context"
import { kindOwner } from "./ops"

/** How far (tiles) a snap answer stays valid around the point it was asked for. */
const VALID = 0.35
/** How far a snap provider's point may pull. */
const REACH = 0.5

/**
 * Extensions' snapping for every tool. Snapping must answer at once while
 * extensions answer asynchronously, so the host asks as the pointer moves
 * and tools use the answer for points near it (the pointer is where tools
 * snap); further away, the square grid.
 */
export function nearestSnap(
  p: Vec2,
  grid: Vec2 | null,
  candidates: readonly Vec2[],
  reach = REACH,
): Vec2 | null {
  let best: Vec2 | null = null
  let bestD = reach
  for (const q of candidates) {
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d <= bestD) {
      best = q
      bestD = d
    }
  }
  return best ?? grid
}

export function startExtensionSnap(): () => void {
  let answer: { from: Vec2; to: Vec2 } | null = null
  let seq = 0
  setSnapOverride((p) =>
    answer && Math.hypot(answer.from.x - p.x, answer.from.y - p.y) <= VALID ? answer.to : null,
  )
  const unsub = useEditorStore.subscribe(async (s, prev) => {
    const p = s.pointer
    if (!p || p === prev.pointer) return
    const kind = useMapStore.getState().map?.grid?.kind ?? "square"
    const grid = kind.startsWith("ext:")
      ? contributionsOf("gridType").find(
          (c) => c.extId === kindOwner(kind) && kind.endsWith(`/${c.contribution.id}`),
        )
      : undefined
    const providers = contributionsOf("snapProvider")
    if (!grid && providers.length === 0) {
      answer = null
      return
    }
    const mine = ++seq
    try {
      const [snapped, ...lists] = await Promise.all([
        grid ? grid.contribution.snap(p) : null,
        ...providers.map((c) => Promise.resolve(c.contribution.points(p, REACH)).catch(() => [])),
      ])
      if (mine !== seq) return
      const to = nearestSnap(
        p,
        (snapped as Vec2 | null) ?? null,
        (lists as Vec2[][]).flat().slice(0, 500),
      )
      answer = to ? { from: p, to } : null
    } catch {
      answer = null
    }
  })
  return () => {
    unsub()
    setSnapOverride(null)
  }
}
