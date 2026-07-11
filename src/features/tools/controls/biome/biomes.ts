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
