import { type Container, Graphics, type StrokeStyle, Text } from "pixi.js"
import { type DraftShape } from "../../../stores/editorStore"
import {
  editablePointsOf,
  entityBounds,
  isStretchable,
  selectionBounds,
  transformHandles,
  type AssetSizeOf,
} from "../model/geometry"
import { type MapEntity, type Vec2 } from "../model/types"
import { ENTITY_RENDERERS, type RenderEnv } from "./entities"
import { tileSizeForZoom } from "./viewport"

/** Selection/draft accent: Open20 crimson, lightened to read over any map. */
const ACCENT = 0xe0534e

/** Ruler distances: the usual 5 ft per square. */
const FEET_PER_TILE = 5

/** A dashed line from `a` to `b` (map space) with `dash`-long dashes. */
function dashed(g: Graphics, a: Vec2, b: Vec2, dash: number, style: StrokeStyle): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const n = Math.max(1, Math.floor(len / (dash * 2)))
  for (let i = 0; i < n; i++) {
    const t0 = (i * 2 * dash) / len
    const t1 = Math.min(1, ((i * 2 + 1) * dash) / len)
    g.moveTo(-(a.x + (b.x - a.x) * t0), a.y + (b.y - a.y) * t0)
    g.lineTo(-(a.x + (b.x - a.x) * t1), a.y + (b.y - a.y) * t1)
  }
  g.stroke(style)
}

/**
 * Editor-only drawing on top of the map: the active tool's drafts and the
 * selection boxes. Line widths are given in screen px and converted to tiles
 * from the zoom, so they stay crisp at any zoom level. Never exported.
 */
export function drawOverlay(
  root: Container,
  draft: readonly DraftShape[],
  selected: readonly MapEntity[],
  sizeOf: AssetSizeOf,
  zoom: number,
  env: RenderEnv,
  /** Draw the selection's scale/rotate handles (Select tool active). */
  handles = false,
): void {
  for (const child of root.removeChildren()) child.destroy({ children: true })
  const px = 1 / tileSizeForZoom(zoom)
  const g = new Graphics()
  const line = { width: 1.5 * px, color: ACCENT, alpha: 0.95 }

  for (const shape of draft) {
    switch (shape.kind) {
      case "polyline":
        if (shape.points.length > 1) {
          g.poly(
            shape.points.flatMap((p) => [-p.x, p.y]),
            !!shape.closed,
          ).stroke(line)
        }
        for (const p of shape.points) g.regularPoly(-p.x, p.y, 3 * px, 12).fill({ color: ACCENT })
        break
      case "polygon":
        if (shape.points.length > 1) {
          g.poly(
            shape.points.flatMap((p) => [-p.x, p.y]),
            true,
          )
            .fill({ color: ACCENT, alpha: 0.15 })
            .stroke(line)
        }
        break
      case "rect": {
        const x0 = -Math.max(shape.a.x, shape.b.x)
        const y0 = Math.min(shape.a.y, shape.b.y)
        g.rect(x0, y0, Math.abs(shape.a.x - shape.b.x), Math.abs(shape.a.y - shape.b.y))
          .fill({ color: ACCENT, alpha: 0.12 })
          .stroke(line)
        break
      }
      case "circle":
        g.circle(-shape.center.x, shape.center.y, shape.radius).stroke(line)
        break
      case "handles":
        for (const p of shape.points) {
          g.rect(-p.x - 4 * px, p.y - 4 * px, 8 * px, 8 * px)
            .fill({ color: 0xffffff })
            .stroke({ ...line, width: 1.5 * px })
        }
        // The selected vertex (Delete removes it): filled with the accent.
        if (shape.active) {
          const a = shape.active
          g.rect(-a.x - 5 * px, a.y - 5 * px, 10 * px, 10 * px)
            .fill({ color: ACCENT })
            .stroke({ color: 0xffffff, width: 1.5 * px })
        }
        break
      case "guide": {
        const { point: p, width, height } = shape
        const guide = { width: 1 * px, color: ACCENT, alpha: 0.7 }
        dashed(g, { x: 0, y: p.y }, { x: width, y: p.y }, 8 * px, guide)
        dashed(g, { x: p.x, y: 0 }, { x: p.x, y: height }, 8 * px, guide)
        break
      }
      case "measure": {
        const { a, b } = shape
        g.moveTo(-a.x, a.y)
          .lineTo(-b.x, b.y)
          .stroke({ ...line, width: 2 * px })
        for (const p of [a, b]) g.regularPoly(-p.x, p.y, 4 * px, 12).fill({ color: ACCENT })
        const tiles = Math.hypot(b.x - a.x, b.y - a.y)
        const label = new Text({
          text: `${tiles.toFixed(1)} · ${Math.round(tiles * FEET_PER_TILE)} ft`,
          style: {
            fontSize: 13,
            fill: 0xffffff,
            fontWeight: "600",
            stroke: { color: 0x000000, width: 3 },
          },
        })
        // Text is sized in screen px: undo the world's scale.
        label.scale.set(px)
        label.anchor.set(0.5, 1.4)
        label.position.set(-(a.x + b.x) / 2, (a.y + b.y) / 2)
        root.addChild(label)
        break
      }
      case "ghost": {
        const render = ENTITY_RENDERERS[shape.entity.toolId]
        if (render) {
          const view = render(shape.entity, env)
          view.alpha = 0.55
          root.addChild(view)
        }
        break
      }
    }
  }

  for (const e of selected) {
    const b = entityBounds(e, sizeOf)
    g.rect(-(b.x + b.w), b.y, b.w, b.h).stroke({ ...line, width: 1.5 * px })
  }

  const box = handles ? selectionBounds(selected, sizeOf) : null
  if (box) {
    // Several items: one box around them all, so the handles read as the group's.
    if (selected.length > 1) {
      g.rect(-(box.x + box.w), box.y, box.w, box.h).stroke({ ...line, width: 1 * px, alpha: 0.7 })
    }
    const h = transformHandles(box, px, isStretchable(selected))
    const topCenter = { x: box.x + box.w / 2, y: box.y }
    g.moveTo(-topCenter.x, topCenter.y).lineTo(-h.rotate.x, h.rotate.y).stroke(line)
    // regularPoly, not circle: circle() picks its segment count from the tiny
    // tile-unit radius (before the world's ~64× scale) and renders a diamond.
    g.regularPoly(-h.rotate.x, h.rotate.y, 5 * px, 16)
      .fill({ color: 0xffffff })
      .stroke(line)
    for (const s of h.scale) {
      g.rect(-s.at.x - 4 * px, s.at.y - 4 * px, 8 * px, 8 * px)
        .fill({ color: 0xffffff })
        .stroke(line)
    }
  }
  // A lone wall/path/area: its control line and draggable points (round, so
  // they read apart from the square scale handles).
  const editable = handles ? editablePointsOf(selected) : null
  if (editable?.points) {
    const pts = editable.points
    g.moveTo(-pts[0].x, pts[0].y)
    for (const p of pts.slice(1)) g.lineTo(-p.x, p.y)
    if (editable.closed) g.lineTo(-pts[0].x, pts[0].y)
    g.stroke({ ...line, width: 1 * px, alpha: 0.8 })
    for (const p of pts) {
      g.regularPoly(-p.x, p.y, 4.5 * px, 12)
        .fill({ color: ACCENT })
        .stroke({ color: 0xffffff, width: 1.5 * px })
    }
  }
  root.addChild(g)
}
