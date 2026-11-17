/**
 * The Google Fonts catalog (built from google/fonts by
 * scripts/fonts-catalog.mjs) and the naming rules around it: style names,
 * imported maps' font_name, where each style's file lives and what it's
 * cached as.
 */

/** One family: its folder in google/fonts, its files and styles [weight, italic, file index]. */
export interface CatalogFamily {
  f: string
  d: string
  files: string[]
  s: [number, 0 | 1, number][]
}

/** A font the text tool can use: a family (Google or system, "" = default) and its style. */
export interface FontChoice {
  family: string
  weight: number
  italic: boolean
}

export const DEFAULT_FONT: FontChoice = { family: "", weight: 400, italic: false }

/** The family used when none is set (or a Google one isn't available). */
export const FALLBACK_FAMILY = "sans-serif"

let catalog: Promise<CatalogFamily[]> | undefined

/** The catalog, loaded on first use (it's a chunk of its own). */
export const loadCatalog = (): Promise<CatalogFamily[]> =>
  (catalog ??= import("./catalog.json").then((m) => m.default as CatalogFamily[]))

const WEIGHT_NAMES: [number, string][] = [
  [100, "Thin"],
  [200, "ExtraLight"],
  [300, "Light"],
  [400, "Regular"],
  [500, "Medium"],
  [600, "SemiBold"],
  [700, "Bold"],
  [800, "ExtraBold"],
  [900, "Black"],
]

/** A style's name as Google Fonts spells it: "Regular", "Italic", "Bold Italic". */
export function styleName(weight: number, italic: boolean): string {
  const name = WEIGHT_NAMES.find(([w]) => w === weight)?.[1] ?? String(weight)
  if (!italic) return name
  return name === "Regular" ? "Italic" : `${name} Italic`
}

/** Aliases some fonts use for a weight, normalized (lowercase, no spaces/dashes). */
const WEIGHT_ALIASES: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
}

/** A style name ("Bold Italic", "SemiBold", "Italic", "") → weight and italic; null when it isn't one. */
export function parseStyle(style: string): { weight: number; italic: boolean } | null {
  let rest = style.toLowerCase().replace(/[\s_-]+/g, "")
  const italic = /(italic|oblique)$/.test(rest)
  rest = rest.replace(/(italic|oblique)$/, "")
  if (rest === "") return { weight: 400, italic }
  const weight = WEIGHT_ALIASES[rest]
  return weight ? { weight, italic } : null
}

/**
 * An imported map's font_name → a font: it stores the family alone for the
 * Regular style, or the family + " " + the style ("Libre Baskerville
 * Bold"). The longest catalog family the name starts with wins; null when
 * none matches.
 */
export function parseFontName(name: string, families: readonly CatalogFamily[]): FontChoice | null {
  const lower = name.trim().toLowerCase()
  let best: { family: string; style: { weight: number; italic: boolean } } | null = null
  for (const fam of families) {
    const f = fam.f.toLowerCase()
    if (lower !== f && !lower.startsWith(f + " ")) continue
    if (best && best.family.length >= fam.f.length) continue
    const style = parseStyle(name.trim().slice(fam.f.length))
    if (style) best = { family: fam.f, style }
  }
  return best && { family: best.family, ...best.style }
}

export const findFamily = (families: readonly CatalogFamily[], family: string) =>
  families.find((f) => f.f === family)

/** The family's style closest to `weight` (same slant when it has one). */
export function nearestStyle(fam: CatalogFamily, weight: number, italic: boolean) {
  const slant = fam.s.filter(([, i]) => !!i === italic)
  const pool = slant.length > 0 ? slant : fam.s
  return pool.reduce((a, b) => (Math.abs(b[0] - weight) < Math.abs(a[0] - weight) ? b : a))
}

/** Where a style's file is downloaded from. */
export function fontUrl(fam: CatalogFamily, weight: number, italic: boolean): string {
  const [, , file] = nearestStyle(fam, weight, italic)
  return `https://raw.githubusercontent.com/google/fonts/main/${fam.d}/${encodeURIComponent(fam.files[file])}`
}

/** The cached file's name: `<Family>-<Style>.ttf`, without spaces. */
export function fontFileName(font: FontChoice): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "")
  return `${clean(font.family)}-${clean(styleName(font.weight, font.italic))}.ttf`
}

/** The CSS font shorthand for `font` at `px` (also what canvas measuring takes). */
export function cssFont(font: FontChoice, px: number, available = true): string {
  const family = font.family && available ? `"${font.family}", ${FALLBACK_FAMILY}` : FALLBACK_FAMILY
  return `${font.italic ? "italic " : ""}${font.weight} ${px}px ${family}`
}
