import { describe, expect, it } from "vitest"
import { type BiomeSelection } from "../../params"
import {
  BIOMES,
  BUILTIN_BIOME_TEXTURES,
  builtinBiomeIds,
  builtinTerrainId,
  hasUnseededBiomes,
  withBuiltinBiomes,
} from "./biomes"

const empty: BiomeSelection = {
  biome: "settlement",
  slotsByBiome: {},
  unlocked: false,
  selectedSlot: 0,
}
const thumb = (id: string) => `/files/${id}`

describe("built-in biome defaults", () => {
  it("gives every biome 4 textures", () => {
    for (const biome of BIOMES) expect(BUILTIN_BIOME_TEXTURES[biome]).toHaveLength(4)
  })

  it("fills the 4 slots of every biome without slots", () => {
    const seeded = withBuiltinBiomes(empty, thumb)
    for (const biome of BIOMES) {
      const slots = seeded.slotsByBiome[biome]
      expect(slots).toHaveLength(4)
      expect(slots?.map((s) => s?.name)).toEqual([...BUILTIN_BIOME_TEXTURES[biome]])
    }
    const first = seeded.slotsByBiome.prairie?.[0]
    expect(first).toEqual({
      id: "open20-essentials|textures/terrain/Grass.webp",
      name: "Grass",
      thumb: "/files/open20-essentials|textures/terrain/Grass.webp",
    })
    expect(hasUnseededBiomes(seeded)).toBe(false)
  })

  it("keeps the biomes the user already set up, even emptied", () => {
    const mine = { id: "p|textures/terrain/x.png", name: "x", thumb: "x" }
    const sel = { ...empty, slotsByBiome: { desert: [mine], swamp: [null, null] } }
    const seeded = withBuiltinBiomes(sel, thumb)
    expect(seeded.slotsByBiome.desert).toEqual([mine])
    expect(seeded.slotsByBiome.swamp).toEqual([null, null])
    expect(seeded.slotsByBiome.barren).toHaveLength(4)
  })

  it("leaves missing textures empty and skips biomes with none found", () => {
    const grass = builtinTerrainId("Grass")
    const seeded = withBuiltinBiomes(empty, (id) => (id === grass ? "g" : null))
    expect(seeded.slotsByBiome.prairie?.map((s) => s?.id ?? null)).toEqual([
      grass,
      null,
      null,
      null,
    ])
    expect(seeded.slotsByBiome.desert).toBeUndefined()
  })

  it("returns the same selection when there is nothing to seed", () => {
    const seeded = withBuiltinBiomes(empty, thumb)
    expect(withBuiltinBiomes(seeded, thumb)).toBe(seeded)
    expect(withBuiltinBiomes(empty, () => null)).toBe(empty)
  })

  it("lists each texture id once", () => {
    const ids = builtinBiomeIds()
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(builtinTerrainId("Thick Moss"))
  })
})
