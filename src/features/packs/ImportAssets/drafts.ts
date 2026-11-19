import { type AssetCategory } from "../../../lib/categories"
import { type ImportItem } from "../api"
import { CATEGORY_SPECS, NO_ADJUST, groupFiles, type Adjust } from "../userAssets"

/** One item in the import window, as the user is shaping it. */
export interface Draft {
  /** Stable id in the list (its main image). */
  key: string
  source: string
  name: string
  category: AssetCategory
  folder: string
  /** Part name → image. */
  parts: Record<string, string>
  adjust: Adjust
  colorable: boolean
  tags: string[]
  color: string | null
}

/** How a fresh item of `category` starts: trimmed when it's placed whole. */
export function defaultAdjust(category: AssetCategory): Adjust {
  return { ...NO_ADJUST, trim: CATEGORY_SPECS[category].trim }
}

/** Drafts for picked files (parts paired with their main image), skipping ones already listed. */
export function draftsFor(
  files: readonly string[],
  category: AssetCategory,
  existing: readonly Draft[] = [],
): Draft[] {
  const taken = new Set(existing.flatMap((d) => [d.source, ...Object.values(d.parts)]))
  return groupFiles(
    files.filter((f) => !taken.has(f)),
    category,
  ).map((g) => ({
    key: g.source,
    source: g.source,
    name: g.name,
    category,
    folder: "",
    parts: g.parts,
    adjust: defaultAdjust(category),
    colorable: false,
    tags: [],
    color: null,
  }))
}

/**
 * Move a draft to another category: parts the new one doesn't have are
 * dropped (they become items of their own), and options it lacks are reset.
 */
export function withCategory(d: Draft, category: AssetCategory): { draft: Draft; loose: string[] } {
  if (d.category === category) return { draft: d, loose: [] }
  const spec = CATEGORY_SPECS[category]
  const kept = new Set(spec.parts)
  const parts: Record<string, string> = {}
  const loose: string[] = []
  for (const [part, src] of Object.entries(d.parts)) {
    if (kept.has(part)) parts[part] = src
    else loose.push(src)
  }
  return {
    draft: {
      ...d,
      category,
      parts,
      adjust: { ...d.adjust, trim: spec.trim },
      colorable: spec.colorable && d.colorable,
      color: spec.color ? d.color : null,
      folder: spec.folder ? d.folder : "",
    },
    loose,
  }
}

/** What the backend receives for a draft. */
export function toImportItem(d: Draft): ImportItem {
  const spec = CATEGORY_SPECS[d.category]
  return {
    source: d.source,
    category: d.category,
    name: d.name.trim() || "Asset",
    folder: spec.folder ? d.folder.trim() : "",
    parts: d.parts,
    adjust: d.adjust,
    colorable: spec.colorable && d.colorable,
    tags: d.tags,
    color: spec.color ? d.color : null,
  }
}
