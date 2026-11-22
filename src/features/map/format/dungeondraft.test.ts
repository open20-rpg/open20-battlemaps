import { describe, expect, it } from "vitest"
import { TERRAIN_SLOTS, decodeWeights, type TerrainData } from "../model/terrain"
import {
  looksLikeDungeondraftMap,
  bitAt,
  bitmapRuns,
  DungeondraftImportError,
  buildingWear,
  importDungeondraftMap,
  PATH_WIDTH_TILES,
  pathWidthMultipliers,
  resToAssetId,
  spriteScale,
} from "./dungeondraft"
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
          // Most wood cells are tan; one is white.
          colors: [
            "ffb08850",
            "ffffffff",
            "ffffffff",
            "ffffffff",
            "ffb08850",
            "ffb08850",
            ...Array(6).fill("ffffffff"),
          ],
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
            prefab_id: "4",
          },
          {
            position: "Vector2( 0, 0 )",
            texture: "res://textures/objects/barrel.png",
            prefab_id: "4",
            locked: true,
          },
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
        texts: [
          {
            text: "Hi",
            position: "Vector2( 0, 0 )",
            font_size: 64,
            font_color: "ff000000",
            font_name: "Libre Baskerville Bold",
            box_shape: 2,
            box_border_width: 3,
            box_background_color: "ffffffff",
            box_border_color: "ff102030",
          },
        ],
        materials: {
          "-400": [
            {
              bitmap: "PoolByteArray( 7 )",
              texture: `${PACK}/materials/cobblestone_tile.png`,
              smooth: true,
            },
          ],
        },
        cave: {
          bitmap: "PoolByteArray( 255, 0 )",
          entrance_bitmap: "PoolByteArray( 0, 1 )",
          ground_color: "ff7f7e71",
        },
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

  it("also depends on packs its assets use that the manifest doesn't list", () => {
    const map = structuredClone(MAP)
    map.header.asset_manifest = [{ id: "listed", name: "Listed" }]
    map.world.levels["0"].walls[0].texture = "res://packs/unlisted/textures/walls/a.png"
    const r = importDungeondraftMap(JSON.stringify(map))
    expect(r.packs).toContain("listed")
    expect(r.packs).toContain("unlisted")
    expect(r.packs).toContain("abcd1234")
    expect(r.packs).not.toContain("dungeondraft")
    expect(new Set(r.packs).size).toBe(r.packs.length)
  })

  it("turns a pattern's texture with its shape (shape_rotation)", () => {
    const map = structuredClone(MAP)
    const pattern = (shape: number, own: number) => ({
      position: "Vector2( 256, 256 )",
      shape_rotation: shape,
      scale: "Vector2( 1, 1 )",
      points: "PoolVector2Array( 0, 0, 512, 0, 512, 512, 0, 512 )",
      layer: 100,
      color: "ffffffff",
      outline: false,
      texture: "res://packs/abcd1234/textures/patterns/normal/a.webp",
      rotation: own,
    })
    ;(map.world.levels["0"] as Record<string, unknown>).patterns = [
      pattern(Math.PI / 2, 0),
      pattern(-1.934082, 0),
      pattern(0, -Math.PI / 2),
      pattern(Math.PI / 2, Math.PI),
    ]
    const r = importDungeondraftMap(JSON.stringify(map))
    const rot = r.doc.entities
      .filter((e) => e.toolId === "pattern")
      .map((e) => Math.round(Number(e.params.rotation) * 10) / 10)
    expect(rot).toEqual([90, -110.8, -90, -90])
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
    expect(floor.params.floor).toMatchObject({
      assets: ["abcd1234|textures/tilesets/wood.png"],
      color: "#b08850",
    })
    expect(run().warnings.looseTiles).toBe(1)
  })

  it("converts objects (rotation in degrees, mirroring kept as flips) and built-in assets", () => {
    const [chair, barrel] = byTool("object")
    expect(chair.position).toEqual({ x: 3.5, y: 0.5 })
    expect(chair.rotation).toBeCloseTo(90)
    expect(chair.scale).toBe(2)
    expect(chair.flipX).toBe(true)
    expect(chair.flipY).toBeUndefined()
    expect(chair.params.color).toBe("#ff0000")
    expect(barrel.params.asset).toBe("dungeondraft|textures/objects/barrel.png")
    expect(run().warnings).toMatchObject({ builtinAssets: 1 })
    // Same prefab_id → same group.
    expect(chair.group).toBe("dd-4")
    expect(barrel.group).toBe(chair.group)
    expect(barrel.locked).toBe(true)
    expect(chair.locked).toBeUndefined()
  })

  it("converts paths, lights, roofs and texts", () => {
    const [path] = byTool("path")
    expect(path.points).toEqual([
      { x: 3, y: 1 },
      { x: 2, y: 1 },
    ])
    expect(path.params).toMatchObject({
      [PATH_WIDTH_TILES]: 0.5,
      transitionIn: "fade",
      transitionOut: "growth",
    })
    // 128 px wide over a 128 px (half-tile) tall texture: Width 1.
    const [converted] = pathWidthMultipliers([path], () => 0.5)
    expect(converted.params.width).toBe(1)
    expect(converted.params[PATH_WIDTH_TILES]).toBeUndefined()
    // Texture unknown (pack missing): counted as one tile tall.
    expect(pathWidthMultipliers([path], () => undefined)[0].params.width).toBe(0.5)
    const [light] = byTool("light")
    expect(light.params).toMatchObject({
      range: 3,
      intensity: 1.5,
      color: "#eccd8b",
      shadow: false,
    })
    const [roof] = byTool("roof")
    expect(roof.params).toMatchObject({ type: "hip", sunDirection: 90, shadeContrast: 0.4 })
    // Dungeondraft's model: the ridge (open) and the eaves' distance from it.
    expect(roof.points).toHaveLength(2)
    expect(roof.closed).toBeFalsy()
    expect(roof.params.width).toBe(0.5)
    const [text] = byTool("text")
    expect(text.text).toBe("Hi")
    // Its top-left corner, the map's top-left (x mirrored), as is.
    expect(text.position).toEqual({ x: 4, y: 0 })
    expect(text.params).toMatchObject({
      font: "Libre Baskerville Bold",
      box: true,
      boxRadius: 100,
      boxBorderWidth: 3,
      boxColor: "#ffffff",
      boxBorderColor: "#102030",
    })
  })

  it("turns bitmaps into strokes, the splat into the level's terrain, water trees into bodies", () => {
    const [caveEntity] = byTool("cave")
    // The dug cells, and the blasted-open ones kept apart (entrance bitmap).
    expect(caveEntity.strokes?.length).toBe(2)
    expect(caveEntity.strokes?.[0].blast).toBeUndefined()
    expect(caveEntity.strokes?.[1].blast).toBe(true)
    expect(caveEntity.strokes?.[0].radius).toBe(1 / 8)
    const terrain = byTool("terrainBrush")
    expect(terrain).toHaveLength(1)
    const data = terrain[0].params.terrain as TerrainData
    expect([data.width, data.height]).toEqual([16, 12])
    expect(data.slots.slice(0, 2)).toEqual([
      "abcd1234|textures/terrain/grass.png",
      "abcd1234|textures/terrain/dirt.png",
    ])
    // Byte for byte, 8 slots per texel: texel (0,0) is all dirt, the next all grass.
    const bytes = decodeWeights(data.weights)
    expect([...bytes.subarray(0, 2)]).toEqual([0, 255])
    expect([...bytes.subarray(TERRAIN_SLOTS, TERRAIN_SLOTS + 2)]).toEqual([255, 0])
    // Materials: one-cell stamps on the 128 px grid, the region's Smooth kept.
    const [material] = byTool("material")
    expect(material.layer).toBe(-400)
    expect(material.strokes?.[0].radius).toBe(1 / 4)
    expect(material.params).toMatchObject({
      material: { assets: ["abcd1234|textures/materials/cobblestone_tile.png"] },
      smooth: true,
    })
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
    expect(() => importDungeondraftMap('{"format":"open20-battle-maps"}')).toThrow(
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

describe("terrain and sprites", () => {
  it("reads the terrain brush setup of the opening level", () => {
    const r = run()
    expect(r.terrain).toBeUndefined() // the map opens on level 1, which has no terrain
    const level0 = importDungeondraftMap(
      JSON.stringify({ ...MAP, header: { ...MAP.header, editor_state: { current_level: 0 } } }),
    )
    expect(level0.terrain).toEqual({
      slots: [
        "abcd1234|textures/terrain/grass.png",
        "abcd1234|textures/terrain/dirt.png",
        null,
        null,
      ],
      expanded: false,
      smoothBlending: false,
      enabled: true,
    })
  })

  it("maps Godot scales to uniform scale plus flips", () => {
    expect(spriteScale({ x: 1, y: -1 })).toEqual({ scale: 1, flipY: true })
    expect(spriteScale({ x: -2, y: 2 })).toEqual({ scale: 2, flipX: true })
    expect(spriteScale({ x: 0.943732, y: 0.943314 }).scale).toBeCloseTo(0.9435)
    expect(resToAssetId("res://packs/P1/textures/a.png")).toBe("P1|textures/a.png")
    expect(resToAssetId("res://textures/b.png")).toBe("dungeondraft|textures/b.png")
  })
})

describe("building wear", () => {
  it("reads world.building_wear by its texture's name", () => {
    expect(buildingWear("res://textures/building_wear/scratched.png")).toBe("scratched")
    expect(buildingWear("res://textures/building_wear/Dust.png")).toBe("dust")
    expect(buildingWear("")).toBe("none")
    expect(buildingWear(null)).toBe("none")
    expect(buildingWear(undefined)).toBe("grime")
    expect(buildingWear("res://packs/x/odd.png")).toBe("grime")
  })
})

describe("looksLikeDungeondraftMap", () => {
  it("tells Dungeondraft maps from .otbm files by their content", () => {
    expect(looksLikeDungeondraftMap('{\n\t"header": {\n\t\t"creation_build": "1.2"')).toBe(true)
    expect(looksLikeDungeondraftMap('{\n  "format": "open20-battle-maps",\n  "header": {}')).toBe(
      false,
    )
    expect(looksLikeDungeondraftMap("not json")).toBe(false)
  })
})
