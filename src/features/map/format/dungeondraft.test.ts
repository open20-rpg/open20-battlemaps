import { describe, expect, it } from "vitest"
import { bitAt, bitmapRuns, DungeondraftImportError, importDungeondraftMap } from "./dungeondraft"
import miniMap from "./__fixtures__/mini.dungeondraft_map?raw"

const PACK = "res://packs/abcd1234/textures"

/** A 4×3-cell map exercising every section the importer converts. */
const MAP = {
  header: {
    asset_manifest: [{ id: "abcd1234", name: "Pack" }],
    editor_state: { current_level: 1 },
  },
  world: {
    format: 3,
    width: 4,
    height: 3,
    msi: { cell_size: 64 },
    grid: { color: "80000000" },
    levels: {
      "0": {
        label: "Ground",
        environment: { ambient_light: "ff202040" },
        shapes: { polygons: ["PoolVector2Array( 0, 0, 512, 0, 512, 512, 0, 512 )"] },
        tiles: {
          cells: "PoolIntArray( 3, 3, -1, 7, 3, 3, -1, -1, -1, -1, -1, -1 )",
          lookup: { "3": `${PACK}/tilesets/wood.png`, "7": `${PACK}/tilesets/stone.png` },
        },
        walls: [
          {
            points: "PoolVector2Array( 0, 0, 512, 0 )",
            texture: `${PACK}/walls/stone.png`,
            color: "ffffffff",
            loop: false,
            joint: 1,
            shadow: true,
            portals: [
              {
                position: "Vector2( 256, 0 )",
                rotation: 0,
                scale: "Vector2( 1, 1 )",
                texture: `${PACK}/portals/door.png`,
                closed: true,
              },
            ],
          },
        ],
        objects: [
          {
            position: "Vector2( 128, 128 )",
            rotation: 1.570796,
            scale: "Vector2( -2, 2 )",
            mirror: true,
            texture: `${PACK}/objects/chair.png`,
            layer: 100,
            custom_color: "ffff0000",
          },
          { position: "Vector2( 0, 0 )", texture: "res://textures/objects/barrel.png" },
        ],
        paths: [
          {
            position: "Vector2( 256, 256 )",
            edit_points: "PoolVector2Array( 0, 0, 256, 0 )",
            texture: `${PACK}/paths/road.png`,
            width: 128,
            fade_in: true,
            shrink: true,
          },
        ],
        lights: [
          {
            position: "Vector2( 512, 256 )",
            range: 3,
            intensity: 1.5,
            color: "ffeccd8b",
            texture: `${PACK}/lights/soft.png`,
            shadows: false,
          },
        ],
        roofs: {
          shade: true,
          sun_direction: 90,
          shade_contrast: 0.4,
          roofs: [{ points: "PoolVector2Array( 0, 128, 512, 128 )", width: 128, type: 1 }],
        },
        texts: [{ text: "Hi", position: "Vector2( 0, 0 )", font_size: 64, font_color: "ff000000" }],
        cave: { bitmap: "PoolByteArray( 255, 0 )", ground_color: "ff7f7e71" },
        terrain: {
          texture_1: `${PACK}/terrain/grass.png`,
          texture_2: `${PACK}/terrain/dirt.png`,
          // 16×12 texels; texel (0,0) is mostly G (dirt), the rest R (grass).
          splat: `PoolByteArray( 0, 255, 0, 0${", 255, 0, 0, 0".repeat(16 * 12 - 1)} )`,
        },
        water: {
          disable_border: true,
          tree: {
            polygon: "PoolVector2Array( )",
            children: [
              {
                polygon: "PoolVector2Array( 0, 512, 256, 512, 256, 768 )",
                deep_color: "ff112233",
                children: [{ polygon: "PoolVector2Array( 10, 520, 20, 520, 20, 530 )" }],
              },
            ],
          },
        },
      },
      "1": { label: "Upstairs", environment: { ambient_light: "ffffffff" } },
    },
  },
}

const run = () => importDungeondraftMap(JSON.stringify(MAP))
const byTool = (tool: string) => run().doc.entities.filter((e) => e.toolId === tool)

describe("Dungeondraft import", () => {
  it("reads size, levels, packs, grid color and ambient light", () => {
    const r = run()
    expect(r.doc.width).toBe(4)
    expect(r.doc.levels.map((l) => l.name)).toEqual(["Ground", "Upstairs"])
    expect(r.currentLevel).toBe(1)
    expect(r.packs).toEqual(["abcd1234"])
    expect(r.gridColor).toBe("#00000080")
    expect(r.doc.environment.ambientLight).toBe("#202040")
    expect(r.warnings.levelAmbient).toBe(1)
  })

  it("mirrors x (cells from the right edge) and maps pack textures to asset ids", () => {
    const [wall] = byTool("wall")
    expect(wall.points).toEqual([
      { x: 4, y: 0 },
      { x: 2, y: 0 },
    ])
    expect(wall.params.wall).toEqual({
      assets: ["abcd1234|textures/walls/stone.png"],
      color: "#ffffff",
    })
    const [door] = byTool("portal")
    expect(door.position).toEqual({ x: 3, y: 0 })
    expect(door.params).toMatchObject({
      asset: "abcd1234|textures/portals/door.png",
      anchored: true,
      blockLight: true,
    })
  })

  it("fills floor shapes with their majority tileset and reports loose tiles", () => {
    const [floor] = byTool("build")
    expect(floor.points).toHaveLength(4)
    expect(floor.params.floor).toMatchObject({ assets: ["abcd1234|textures/tilesets/wood.png"] })
    expect(run().warnings.looseTiles).toBe(1)
  })

  it("converts objects (rotation in degrees, mirroring reported) and built-in assets", () => {
    const [chair, barrel] = byTool("object")
    expect(chair.position).toEqual({ x: 3.5, y: 0.5 })
    expect(chair.rotation).toBeCloseTo(90)
    expect(chair.scale).toBe(2)
    expect(chair.params.color).toBe("#ff0000")
    expect(barrel.params.asset).toBe("dungeondraft|textures/objects/barrel.png")
    expect(run().warnings).toMatchObject({ mirroredObjects: 1, builtinAssets: 1 })
  })

  it("converts paths, lights, roofs and texts", () => {
    const [path] = byTool("path")
    expect(path.points).toEqual([
      { x: 3, y: 1 },
      { x: 2, y: 1 },
    ])
    expect(path.params).toMatchObject({ width: 0.5, transitionIn: "fade", transitionOut: "growth" })
    const [light] = byTool("light")
    expect(light.params).toMatchObject({
      range: 3,
      intensity: 1.5,
      color: "#eccd8b",
      shadow: false,
    })
    const [roof] = byTool("roof")
    expect(roof.params).toMatchObject({ type: "hip", sunDirection: 90, shadeContrast: 0.4 })
    expect(roof.points).toHaveLength(4)
    const [text] = byTool("text")
    expect(text.text).toBe("Hi")
    // Top-left (4, 0) → center inside the map, left of the right edge.
    expect(text.position.x).toBeLessThan(4)
    expect(text.position.y).toBeGreaterThan(0)
  })

  it("turns bitmaps and splats into strokes, and water trees into bodies", () => {
    const [caveEntity] = byTool("cave")
    expect(caveEntity.strokes?.length).toBe(1)
    const terrain = byTool("terrainBrush")
    expect(terrain[0].params).toMatchObject({
      fill: true,
      texture: "abcd1234|textures/terrain/grass.png",
    })
    expect(terrain[1].params.texture).toBe("abcd1234|textures/terrain/dirt.png")
    expect(terrain[1].strokes).toHaveLength(1)
    const [lake] = byTool("water")
    expect(lake.params).toMatchObject({ deepColor: "#112233", disableBorder: true })
    expect(run().warnings.waterHoles).toBe(1)
  })

  it("imports the minimal real-world fixture", () => {
    const r = importDungeondraftMap(miniMap)
    expect(r.doc.width).toBe(2)
    expect(r.doc.levels[0].name).toBe("Ground")
    expect(r.doc.entities.some((e) => e.toolId === "wall")).toBe(true)
  })

  it("rejects files that aren't Dungeondraft maps", () => {
    expect(() => importDungeondraftMap("{")).toThrow(DungeondraftImportError)
    expect(() => importDungeondraftMap('{"format":"opendraft-map"}')).toThrow(
      DungeondraftImportError,
    )
  })
})

describe("bitmaps", () => {
  it("reads bits LSB-first and groups runs per row", () => {
    const bytes = Uint8Array.from([0b00000110, 0b00000001])
    expect(bitAt(bytes, 1)).toBe(true)
    expect(bitAt(bytes, 0)).toBe(false)
    // 3×3 grid: row 0 = bits 0-2 (0,1,1), row 1 = bits 3-5 (0,0,0), row 2 = bits 6-8 (0,0,1).
    expect(bitmapRuns(bytes, 3, 3)).toEqual([
      [0, 1, 2],
      [2, 2, 2],
    ])
  })
})
