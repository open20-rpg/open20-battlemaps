import { type MapEntity } from "./types"

/**
 * The layer an entity is drawn at. Portals keep the document layer Dungeondraft
 * gives them (Portals 500, under Walls 600) but, as in Dungeondraft, show over
 * the wall they sit in: the door's frame overlaps the wall's ends around the
 * opening. They still stay under "Above Walls" (700).
 */
export function drawLayer(entity: Pick<MapEntity, "toolId" | "layer">): number {
  return entity.toolId === "portal" ? PORTAL_DRAW_LAYER : entity.layer
}

const PORTAL_DRAW_LAYER = 650

/** Draw order: layer bucket first, then document order within it. */
export const zFor = (layer: number, index: number) => (layer + 1000) * 100000 + index
