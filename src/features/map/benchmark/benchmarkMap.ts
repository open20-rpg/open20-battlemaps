import { createTerrain, encodeWeights, TERRAIN_SLOTS } from "../model/terrain"
import {
  createDocument,
  DEFAULT_LEVEL_ID,
  type MapDocument,
  type MapEntity,
  type Vec2,
} from "../model/types"
import { ellipsePolygon, rectPolygon } from "../model/geometry"

/**
 * The automatic graphics setup's test map: no picture in particular, but a
 * bit of everything the renderer draws (a blended terrain, rooms with
 * floors and walls, patterns, water, paths, many objects with shadows and
 * lights that cut shadows), so a frame of it costs about what a busy real
 * map does. Built from whatever assets are given (the built-in pack's).
 */
export interface BenchmarkAssets {
  terrain: string[]
  objects: string[]
  walls: string[]
  tilesets: string[]
  paths: string[]
}

export const BENCHMARK_MAP_SIZE = { width: 36, height: 24 }

/** Objects scattered over the map. */
const OBJECTS = 90
const LIGHTS = 6

/** A small seeded generator: the same map every time. */
function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const pick = <T>(list: readonly T[], i: number): T | undefined =>
  list.length ? list[i % list.length] : undefined

const selection = (id: string | undefined) => ({ assets: id ? [id] : [], color: "#ffffff" })

export function benchmarkMap(assets: BenchmarkAssets): MapDocument {
  const { width, height } = BENCHMARK_MAP_SIZE
  const rnd = random(20)
  const doc = createDocument(width, height, "grime")
  let n = 0
  const entity = (fields: Partial<MapEntity> & Pick<MapEntity, "toolId" | "layer">): MapEntity => ({
    id: `bench-${n++}`,
    level: DEFAULT_LEVEL_ID,
    position: { x: 0, y: 0 },
    rotation: 0,
    params: {},
    ...fields,
  })
  const entities: MapEntity[] = []

  // Terrain: the slots blended in waves, so the shader mixes several.
  const terrain = createTerrain(doc, assets.terrain.slice(0, TERRAIN_SLOTS))
  const slots = Math.max(1, Math.min(4, assets.terrain.length))
  const weights = new Uint8Array(terrain.width * terrain.height * TERRAIN_SLOTS)
  for (let y = 0; y < terrain.height; y++) {
    for (let x = 0; x < terrain.width; x++) {
      const wave = (Math.sin(x * 0.11) + Math.cos(y * 0.13) + 2) / 4
      const at = wave * (slots - 1)
      const lo = Math.floor(at)
      const t = (y * terrain.width + x) * TERRAIN_SLOTS
      weights[t + lo] = Math.round((1 - (at - lo)) * 255)
      if (lo + 1 < slots) weights[t + lo + 1] = 255 - weights[t + lo]
    }
  }
  entities.push(
    entity({
      toolId: "terrainBrush",
      layer: -500,
      params: { terrain: { ...terrain, weights: encodeWeights(weights) } },
    }),
  )

  // Rooms: a floor and the wall around it, linked.
  for (let i = 0; i < 4; i++) {
    const x = 3 + (i % 2) * 16
    const y = 2 + Math.floor(i / 2) * 11
    const points = rectPolygon({ x, y }, { x: x + 10, y: y + 7 })
    const link = `bench-room-${i}`
    entities.push(
      entity({
        toolId: "build",
        layer: -200,
        link,
        points,
        closed: true,
        params: { floor: selection(pick(assets.tilesets, i)), bevelCorners: true, shadow: true },
      }),
      entity({
        toolId: "wall",
        layer: 600,
        link,
        points,
        closed: true,
        position: points[0],
        params: { wall: selection(pick(assets.walls, i)), bevelCorners: true, shadow: true },
      }),
    )
  }

  // Patterns, turned.
  for (let i = 0; i < 3; i++) {
    const x = 1 + i * 11
    entities.push(
      entity({
        toolId: "pattern",
        layer: 100,
        points: rectPolygon({ x, y: 9.5 }, { x: x + 6, y: 13.5 }),
        closed: true,
        params: {
          pattern: selection(pick(assets.tilesets, i + 4)),
          customColor: "#ffffff",
          rotation: 15 * i,
          outline: false,
          shadow: true,
        },
      }),
    )
  }

  // A pond.
  entities.push(
    entity({
      toolId: "water",
      layer: 0,
      points: ellipsePolygon({ x: 26, y: 15 }, { x: 34, y: 22 }),
      closed: true,
      params: {
        deepColor: "#3aa19a",
        shallowColor: "#8bceb0",
        blendDistance: 1.5,
        disableBorder: false,
      },
    }),
  )

  // Winding paths.
  for (let i = 0; i < 2; i++) {
    const points: Vec2[] = Array.from({ length: 8 }, (_, k) => ({
      x: 1 + k * 4.5,
      y: 4 + i * 14 + Math.sin(k + i) * 2,
    }))
    entities.push(
      entity({
        toolId: "path",
        layer: 100,
        points,
        position: points[0],
        params: {
          asset: pick(assets.paths, i) ?? "",
          width: 1,
          smoothness: 1,
          blockLight: false,
          shadow: true,
        },
      }),
    )
  }

  for (let i = 0; i < OBJECTS; i++) {
    const asset = pick(assets.objects, i)
    if (!asset) break
    entities.push(
      entity({
        toolId: "object",
        layer: 100,
        position: { x: 0.5 + rnd() * (width - 1), y: 0.5 + rnd() * (height - 1) },
        rotation: Math.round(rnd() * 360) - 180,
        scale: 1,
        params: { asset, color: "", shadow: true, blockLight: false },
      }),
    )
  }

  for (let i = 0; i < LIGHTS; i++) {
    entities.push(
      entity({
        toolId: "light",
        layer: 700,
        position: { x: 4 + (i % 3) * 13, y: 5 + Math.floor(i / 3) * 12 },
        params: {
          range: 7,
          intensity: 1,
          shadow: true,
          color: "#eccd8b",
          style: selection(undefined),
        },
      }),
    )
  }

  return { ...doc, environment: { ambientLight: "#8a8a9e" }, entities }
}
