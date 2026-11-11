import { DEFAULT_FONT } from "../fonts/catalog"
import { type MapDocument, type MapEntity } from "./model/types"

type Params = Record<string, unknown>

/** A version-1 label's look in today's params: a font object, a box shape. */
function textParamsV2(params: Params): Params {
  // "sharpenFonts" is gone: distance-field text is sharp at any zoom.
  const rest = Object.fromEntries(
    Object.entries(params).filter(([k]) => !["sharpenFonts", "textBox", "font"].includes(k)),
  )
  const { textBox, font } = params
  return {
    ...rest,
    font: typeof font === "string" ? { ...DEFAULT_FONT, family: font } : (font ?? DEFAULT_FONT),
    ...(textBox === undefined ? {} : { boxShape: textBox === true ? "rectangle" : "none" }),
  }
}

/**
 * Version 1 labels were centered on their position and could span lines;
 * now a label is one line whose position is its box's top-left corner. The
 * old footprint (0.6 em per letter, 1.2 em per line) gives where that corner
 * was. Screen-left is the larger map x (mirrored).
 */
function textV2(e: MapEntity): MapEntity {
  const size = (typeof e.params.fontSize === "number" ? e.params.fontSize : 32) / 64
  const lines = (e.text ?? "").split("\n")
  const w = Math.max(1, ...lines.map((l) => l.length)) * size * 0.6
  const h = lines.length * size * 1.2
  return {
    ...e,
    position: { x: e.position.x + w / 2, y: e.position.y - h / 2 },
    text: lines.map((l) => l.trim()).join(" "),
    params: textParamsV2(e.params),
  }
}

/** Bring a map and its tool params saved as `version` up to date. */
export function migrateMap(
  version: number,
  map: MapDocument,
  tools: Record<string, Params>,
): { map: MapDocument; tools: Record<string, Params> } {
  if (version >= 2) return { map, tools }
  return {
    map: { ...map, entities: map.entities.map((e) => (e.toolId === "text" ? textV2(e) : e)) },
    tools: tools.text ? { ...tools, text: textParamsV2(tools.text) } : tools,
  }
}
