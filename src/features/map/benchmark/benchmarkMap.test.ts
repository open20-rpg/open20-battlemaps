import { describe, expect, it } from "vitest"
import { decodeWeights, TERRAIN_SLOTS, type TerrainData } from "../model/terrain"
import { BENCHMARK_MAP_SIZE, benchmarkMap } from "./benchmarkMap"

const assets = {
  terrain: ["t|a", "t|b", "t|c", "t|d"],
  objects: ["o|1", "o|2", "o|3"],
  walls: ["w|1"],
  tilesets: ["s|1", "s|2"],
  paths: ["p|1"],
}

describe("benchmarkMap", () => {
  it("holds a bit of everything the renderer draws", () => {
    const doc = benchmarkMap(assets)
    const count = (tool: string) => doc.entities.filter((e) => e.toolId === tool).length
    expect(count("terrainBrush")).toBe(1)
    expect(count("build")).toBe(4)
    expect(count("wall")).toBe(4)
    expect(count("pattern")).toBe(3)
    expect(count("water")).toBe(1)
    expect(count("path")).toBe(2)
    expect(count("object")).toBe(90)
    expect(count("light")).toBe(6)
    expect(doc.environment.ambientLight).not.toBe("#ffffff")
    expect(new Set(doc.entities.map((e) => e.id)).size).toBe(doc.entities.length)
  })

  it("is the same map every time, everything inside it", () => {
    const a = benchmarkMap(assets)
    expect(benchmarkMap(assets)).toEqual(a)
    const { width, height } = BENCHMARK_MAP_SIZE
    for (const e of a.entities) {
      for (const p of [e.position, ...(e.points ?? [])]) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(width)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(height)
      }
    }
  })

  it("blends the terrain slots (every texel's weights add up)", () => {
    const terrain = benchmarkMap(assets).entities[0].params.terrain as TerrainData
    const w = decodeWeights(terrain.weights)
    const used = new Set<number>()
    for (let t = 0; t < terrain.width * terrain.height; t++) {
      let sum = 0
      for (let s = 0; s < TERRAIN_SLOTS; s++) {
        sum += w[t * TERRAIN_SLOTS + s]
        if (w[t * TERRAIN_SLOTS + s] > 0) used.add(s)
      }
      expect(sum).toBe(255)
    }
    expect(used.size).toBeGreaterThan(2)
  })

  it("still builds without any asset (untextured)", () => {
    const doc = benchmarkMap({ terrain: [], objects: [], walls: [], tilesets: [], paths: [] })
    expect(doc.entities.filter((e) => e.toolId === "object")).toHaveLength(0)
    expect(doc.entities.some((e) => e.toolId === "water")).toBe(true)
  })
})
