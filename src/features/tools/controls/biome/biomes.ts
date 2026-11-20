import { type BiomeSelection, type BiomeTexture } from "../../params"
import { ESSENTIALS_PACK_ID } from "../../../packs/essentials"

/** Fixed biome options (translated in the UI via `biomes.<id>`). */
export const BIOMES = [
  "barren",
  "desert",
  "mountain",
  "prairie",
  "rainforest",
  "settlement",
  "swamp",
] as const

export type Biome = (typeof BIOMES)[number]

/**
 * Terrain textures of Open20 Essentials each biome starts with, one per
 * always-visible slot (slot 0 is the base). Names are the pack's
 * `textures/terrain/<name>.webp` files (tex_ground / tex_terrain2).
 */
export const BUILTIN_BIOME_TEXTURES: Record<Biome, readonly [string, string, string, string]> = {
  barren: ["Cracked Earth", "Dead Grass", "Coarse Gravel", "Dried Mud"],
  desert: ["Desert Dunes", "Red Sand", "Sandstone Ground", "Salt Flats"],
  mountain: ["Rocky Ground", "Granite Ground", "Tundra", "Fresh Snow"],
  prairie: ["Grass", "Long Grass", "Wildflower Meadow", "Dirt"],
  rainforest: ["Jungle Floor", "Lush Grass", "Thick Moss", "Mud"],
  settlement: ["Grass", "Packed Earth", "Muddy Tracks", "Fine Gravel"],
  swamp: ["Marsh", "Swamp Muck", "Bog", "Thick Moss"],
}

/** Library id of an Essentials terrain texture. */
export const builtinTerrainId = (name: string) =>
  `${ESSENTIALS_PACK_ID}|textures/terrain/${name}.webp`

/** Every Essentials texture id the biome defaults use (deduplicated). */
export const builtinBiomeIds = (): string[] => [
  ...new Set(Object.values(BUILTIN_BIOME_TEXTURES).flatMap((names) => names.map(builtinTerrainId))),
]

/** Whether some biome has no slots yet (so {@link withBuiltinBiomes} would seed it). */
export const hasUnseededBiomes = (selection: BiomeSelection): boolean =>
  BIOMES.some((biome) => !selection.slotsByBiome[biome])

/**
 * Give every biome that has no slots yet its Essentials textures. Biomes the
 * user already touched (even emptied) are kept as they are. `thumbOf` maps a
 * texture id to its file, or null when it can't be found (that slot stays
 * empty; a biome where none is found is left unseeded). Returns `selection`
 * itself when nothing changes.
 */
export function withBuiltinBiomes(
  selection: BiomeSelection,
  thumbOf: (id: string) => string | null,
): BiomeSelection {
  let slotsByBiome = selection.slotsByBiome
  for (const biome of BIOMES) {
    if (slotsByBiome[biome]) continue
    const slots = BUILTIN_BIOME_TEXTURES[biome].map((name): BiomeTexture | null => {
      const id = builtinTerrainId(name)
      const thumb = thumbOf(id)
      return thumb ? { id, name, thumb } : null
    })
    if (slots.every((s) => !s)) continue
    if (slotsByBiome === selection.slotsByBiome) slotsByBiome = { ...slotsByBiome }
    slotsByBiome[biome] = slots
  }
  return slotsByBiome === selection.slotsByBiome ? selection : { ...selection, slotsByBiome }
}

/** Every texture id in the selection's slots (deduplicated). */
export const slotIds = (selection: BiomeSelection): string[] => [
  ...new Set(
    Object.values(selection.slotsByBiome).flatMap((slots) =>
      slots.flatMap((slot) => (slot ? [slot.id] : [])),
    ),
  ),
]

/**
 * Point every slot at its texture's library thumbnail (`thumbOf`, null when
 * unknown: that slot is left as is). Slots seeded before thumbnails were
 * looked up showed the texture file itself, its blend alpha included.
 * Returns `selection` itself when nothing changes.
 */
export function withSlotThumbnails(
  selection: BiomeSelection,
  thumbOf: (id: string) => string | null,
): BiomeSelection {
  let changed = false
  const slotsByBiome = Object.fromEntries(
    Object.entries(selection.slotsByBiome).map(([biome, slots]) => [
      biome,
      slots.map((slot) => {
        const thumb = slot ? thumbOf(slot.id) : null
        if (!slot || !thumb || thumb === slot.thumb) return slot
        changed = true
        return { ...slot, thumb }
      }),
    ]),
  )
  return changed ? { ...selection, slotsByBiome } : selection
}
