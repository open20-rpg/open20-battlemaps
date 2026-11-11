import { type Container, Graphics } from "pixi.js"
import { type DraftShape } from "../../../stores/editorStore"
import { entityBounds, type AssetSizeOf } from "../model/geometry"
import { type MapEntity } from "../model/types"
import { ENTITY_RENDERERS, type RenderEnv } from "./entities"
import { tileSizeForZoom } from "./viewport"

const ACCENT = 0x5aa9ff

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
        for (const p of shape.points) g.circle(-p.x, p.y, 3 * px).fill({ color: ACCENT })
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
        break
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
  root.addChild(g)
}
