export interface MapTemplate {
  id: string
  name: string
  /** Width in tiles. */
  width: number
  /** Height in tiles. */
  height: number
  /** Built-in templates cannot be deleted. */
  builtin?: boolean
}

/** Default, non-deletable templates. */
export const DEFAULT_TEMPLATES: MapTemplate[] = [
  { id: "tv40", name: '40" TV', width: 35, height: 20, builtin: true },
  { id: "tv55", name: '55" TV', width: 48, height: 27, builtin: true },
  { id: "a4", name: "A4 Paper", width: 11, height: 8, builtin: true },
  { id: "a3", name: "A3 Paper", width: 16, height: 11, builtin: true },
]
