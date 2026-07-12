/** Pixel size of one tile at 100% zoom. */
export const BASE_TILE_PX = 64

export const ZOOM_MIN = 10
export const ZOOM_MAX = 800

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/** Tile size in px for a given zoom percentage (e.g. 100 = 100%). */
export function tileSizeForZoom(zoom: number): number {
  return BASE_TILE_PX * (zoom / 100)
}

/**
 * The world container's transform for a `width` x `height` map (in tiles)
 * centered inside a `containerWidth` x `containerHeight` (px) viewport.
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
}

export function computeWorldTransform(
  containerWidth: number,
  containerHeight: number,
  mapWidth: number,
  mapHeight: number,
  zoom: number,
): WorldTransform {
  const tileSize = tileSizeForZoom(zoom)
  const mapPxWidth = mapWidth * tileSize
  const mapPxHeight = mapHeight * tileSize
  return {
    // Top-right corner of the centered map rect (map-space x = 0).
    x: (containerWidth + mapPxWidth) / 2,
    y: (containerHeight - mapPxHeight) / 2,
    scaleX: -tileSize,
    scaleY: tileSize,
  }
}
