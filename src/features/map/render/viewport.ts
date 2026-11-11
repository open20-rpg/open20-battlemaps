/** Pixel size of one tile at 100% zoom. */
export const BASE_TILE_PX = 64

export const ZOOM_MIN = 10
export const ZOOM_MAX = 800

/** At least this many screen px of the map must stay visible while panning. */
export const PAN_VISIBLE_MARGIN = 200

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/** Tile size in px for a given zoom percentage (e.g. 100 = 100%). */
export function tileSizeForZoom(zoom: number): number {
  return BASE_TILE_PX * (zoom / 100)
}

/**
 * The world container's transform for a `width` x `height` map (in tiles)
 * inside a `containerWidth` x `containerHeight` (px) viewport, centered plus
 * `pan` (screen px), clamped so the map can never be panned fully off-screen.
 *
 * The map's own coordinate system is mirrored on X relative to the screen:
 * map x = 0 sits at the map's right edge and increases leftward, while y
 * behaves normally (0 at the top, increasing downward). A negative X scale
 * gives us that mirroring for free — every child drawn in plain map-tile
 * units (including the grid) is placed and scaled correctly by Pixi with no
 * manual per-point transform needed.
 */
export interface WorldTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  /** The pan actually applied, after clamping — feed this back into the pan store. */
  pan: { x: number; y: number }
}

function clamp(value: number, min: number, max: number): number {
  return min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max)
}

export function computeWorldTransform(
  containerWidth: number,
  containerHeight: number,
  mapWidth: number,
  mapHeight: number,
  zoom: number,
  pan: { x: number; y: number },
): WorldTransform {
  const tileSize = tileSizeForZoom(zoom)
  const mapPxWidth = mapWidth * tileSize
  const mapPxHeight = mapHeight * tileSize
  // Top-right corner of the centered map rect (map-space x = 0), before pan.
  const centerX = (containerWidth + mapPxWidth) / 2
  const centerY = (containerHeight - mapPxHeight) / 2

  // Smaller maps/zoom levels can't offer a full margin's worth of themselves —
  // fall back to whatever the map actually measures so the range stays sane.
  const marginX = Math.min(PAN_VISIBLE_MARGIN, mapPxWidth)
  const marginY = Math.min(PAN_VISIBLE_MARGIN, mapPxHeight)

  // Origin (map top-right corner) must stay within these bounds so at least
  // `margin` px of the map rect overlaps the viewport on every side.
  const originX = clamp(centerX + pan.x, marginX, containerWidth - marginX + mapPxWidth)
  const originY = clamp(centerY + pan.y, marginY - mapPxHeight, containerHeight - marginY)

  return {
    x: originX,
    y: originY,
    scaleX: -tileSize,
    scaleY: tileSize,
    pan: { x: originX - centerX, y: originY - centerY },
  }
}

/**
 * Inverse of {@link computeWorldTransform}: a point in container (screen) px
 * to map tile coordinates. Uses the same clamped transform the canvas shows.
 */
export function screenToMap(
  screen: { x: number; y: number },
  containerWidth: number,
  containerHeight: number,
  mapWidth: number,
  mapHeight: number,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  const t = computeWorldTransform(containerWidth, containerHeight, mapWidth, mapHeight, zoom, pan)
  return { x: (screen.x - t.x) / t.scaleX, y: (screen.y - t.y) / t.scaleY }
}

/** Map tile coordinates to container (screen) px — the forward of {@link screenToMap}. */
export function mapToScreen(
  p: { x: number; y: number },
  containerWidth: number,
  containerHeight: number,
  mapWidth: number,
  mapHeight: number,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  const t = computeWorldTransform(containerWidth, containerHeight, mapWidth, mapHeight, zoom, pan)
  return { x: t.x + p.x * t.scaleX, y: t.y + p.y * t.scaleY }
}
