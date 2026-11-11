import { type MapEntity } from "../map/model/types"
import { DEFAULT_FONT, parseFontName, type CatalogFamily } from "./catalog"

/**
 * Imported labels keep Dungeondraft's font_name ("Libre Baskerville Bold");
 * this turns each into a font (family + weight + slant) from the catalog.
 * A name the catalog doesn't know falls back to the default font and is
 * counted, so the import can say so.
 */
export function resolveFontNames(
  entities: readonly MapEntity[],
  catalog: readonly CatalogFamily[],
): { entities: MapEntity[]; unknown: number } {
  let unknown = 0
  const out = entities.map((e) => {
    const name = e.params.font
    if (e.toolId !== "text" || typeof name !== "string") return e
    const font = name ? parseFontName(name, catalog) : DEFAULT_FONT
    if (!font) unknown++
    return { ...e, params: { ...e.params, font: font ?? DEFAULT_FONT } }
  })
  return { entities: out, unknown }
}
