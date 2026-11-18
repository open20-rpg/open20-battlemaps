import { type FontChoice } from "../fonts/catalog"
import { type IconType } from "react-icons"
import { type AssetCategory } from "../../lib/categories"

/** Within a layer, whether the tool places new items on top or at the bottom. */
export type Sorting = "over" | "under"

/** The geometry a shape/area tool draws with. `brush` free-paints with the brush size. */
export type Shape = "rectangle" | "ellipse" | "path" | "brush"

/** Value stored by an asset-picker param: chosen asset ids plus a tint color. */
export interface AssetSelection {
  assets: string[]
  color: string
  /**
   * The picked asset's own default color (walls and tilesets, from its pack):
   * what picking it set the color to, and what "restore" goes back to.
   */
  defaultColor?: string
}

/**
 * How an asset picker colors its grid:
 *  - "own": shows its own color swatch, stored in the value (Build floor/wall…).
 *  - "none": no color — plain thumbnails, no swatch (Roof Style).
 *  - { fromParam }: recolored by a sibling param, no swatch (Cave Style by
 *    `groundColor`); the value's own `color` is then unused.
 */
export type AssetRecolor = "own" | "none" | { fromParam: string }

/** One choice of a `segmented` param (its stored value + i18n label + icon). */
export interface SegmentedChoice {
  value: string
  labelKey: string
  icon?: IconType
}

/** A terrain texture assigned to a biome slot (enough to render it standalone). */
export interface BiomeTexture {
  /** Library item id ("{packId}|{relPath}"). */
  id: string
  name: string
  /** Thumbnail file path (render via thumbUrl). */
  thumb: string
}

/**
 * Value of a `biome` param: the picked biome plus each biome's own texture
 * slots. Slots are stored per biome, so switching biomes swaps the visible
 * textures and switching back restores them. Up to {@link BIOME_MAX_SLOTS}
 * slots per biome — the first 4 always show, 4 more when `unlocked`.
 */
export interface BiomeSelection {
  biome: string
  slotsByBiome: Record<string, (BiomeTexture | null)[]>
  unlocked: boolean
  /** Index of the slot the brush/fill paints with. */
  selectedSlot: number
}

export const BIOME_MAX_SLOTS = 8

/**
 * Value of a `missingAssets` param (Replace Assets): the missing asset picked
 * in its list and which of its uses is being shown (null: all of them).
 */
export interface MissingFocus {
  asset: string | null
  index: number | null
}

export const NO_FOCUS: MissingFocus = { asset: null, index: null }

/**
 * The value type each param kind reads/writes. This is the single source of
 * truth tying a `kind` to its runtime value — controls and consumers narrow
 * through it instead of casting `unknown` by hand.
 */
export interface ParamValueByKind {
  customColor: string
  layer: number
  sorting: Sorting
  switch: boolean
  segmented: string
  slider: number
  range: [number, number]
  shape: Shape | null
  brushSize: number
  editPoints: boolean
  assetPicker: AssetSelection
  biome: BiomeSelection
  /** Command buttons hold no value — they only dispatch an action. */
  button: null
  /** Selected font: family ("" = default) and style. */
  font: FontChoice
  /** The Levels list edits the document directly; it holds no tool value. */
  levels: null
  /** Selected prefab id (null = none). */
  prefabs: string | null
  /** The selected entities' own properties (Select tool); edits the document, holds no value. */
  properties: null
  /** Ids of the options switched on. */
  iconToggles: string[]
  /** The map's missing assets, to locate and replace (Replace Assets). */
  missingAssets: MissingFocus
}

export type ParamKind = keyof ParamValueByKind

/** A per-tool parameter bag, keyed by each spec's `paramKey`. */
export type ToolParamValues = Record<string, unknown>

/**
 * Fields every param spec carries: an explicit storage key (two params of the
 * same kind on one tool can no longer collide) and the default value — which
 * lives ONLY here; controls receive resolved values and keep no fallbacks.
 * `visibleWhen` gates the control on the tool's current params (e.g. Portal's
 * Rotate 180 vs Rotation, gated on `anchored`).
 */
interface BaseSpec<K extends ParamKind> {
  kind: K
  paramKey: string
  default: ParamValueByKind[K]
  visibleWhen?: (values: ToolParamValues) => boolean
}

export type ToolParamSpec =
  /**
   * Preset-swatch color picker (`labelKey` names it: Custom/Ground/Wall…).
   * `presets` overrides the built-in swatches for this param (e.g. Water).
   */
  | (BaseSpec<"customColor"> & { labelKey: string; presets?: string[] })
  | (BaseSpec<"layer"> & { allowed: number[] })
  | BaseSpec<"sorting">
  /** On/off switch (Shadow, Bevel Corners, Rotate 180, Block Light, …). */
  | (BaseSpec<"switch"> & {
      labelKey: string
      /** Explanation shown in a tooltip on an info icon next to the label. */
      tooltipKey?: string
    })
  /** Segmented single-choice control (Brush Mode: Dig Cave / Blast Open, …). */
  | (BaseSpec<"segmented"> & { labelKey: string; options: SegmentedChoice[] })
  /** Plain numeric slider (Rotation, …). */
  | (BaseSpec<"slider"> & { labelKey: string; min: number; max: number; step: number })
  /** Two-thumb range slider with numeric ends (Scatter Rotation/Scale). */
  | (BaseSpec<"range"> & { labelKey: string; min: number; max: number; step: number })
  /** Shape selector. `allowBrush` adds a free-paint "brush" option (Water Brush). */
  | (BaseSpec<"shape"> & { allowBrush: boolean })
  /** Draggable size slider, always visible and never null. */
  | (BaseSpec<"brushSize"> & { min: number; max: number; step: number })
  /** Edit-points toggle; `labelKey` names it (Edit Points / Edit Path…). */
  | (BaseSpec<"editPoints"> & { labelKey: string })
  /** Embedded asset browser + color, stored as an {@link AssetSelection}. */
  | (BaseSpec<"assetPicker"> & {
      labelKey: string
      category: AssetCategory
      select: "single" | "multi"
      /** Show an empty first cell that selects "no asset" (null). */
      allowNull: boolean
      /** Grid color source (defaults to "own"). See {@link AssetRecolor}. */
      recolor?: AssetRecolor
    })
  /** Biome selector + terrain texture slots (Terrain Brush). */
  | (BaseSpec<"biome"> & { labelKey: string })
  /** Command button (Text's Delete); `disabled` gates it (always false for now). */
  | (BaseSpec<"button"> & {
      labelKey: string
      icon: IconType
      colorPalette?: string
      disabled?: boolean
    })
  /** Font selector: Google Fonts and the system's, with their styles (Text tool). */
  | (BaseSpec<"font"> & { labelKey: string })
  /** The map's level (floor) list: add, rename, reorder, delete, pick the active one. */
  | BaseSpec<"levels">
  /** Saved prefabs list; picks the one the Prefabs tool stamps. */
  | (BaseSpec<"prefabs"> & { labelKey: string })
  /** Properties of the selected entities (Select tool), edited in place. */
  | BaseSpec<"properties">
  /** The map's missing assets: pick one to show it, swap it for an installed one. */
  | BaseSpec<"missingAssets">
  /** Square on/off icon buttons in rows, under a title (Select's element filter). */
  | (BaseSpec<"iconToggles"> & {
      labelKey: string
      options: readonly { value: string; labelKey: string; icon: IconType }[]
    })

/**
 * Cross-field rule run right after a param change: given the already-merged
 * params and the patch that caused the change, it returns the params to store.
 * Use it to keep dependent params consistent (e.g. mutually-exclusive fields)
 * instead of reacting after the fact with an effect.
 */
export type ParamNormalizer = (merged: ToolParamValues, patch: ToolParamValues) => ToolParamValues

/**
 * Materialize a tool's params: every declared spec contributes its default,
 * overlaid with whatever is stored. This is the ONLY place defaults are
 * resolved — any consumer (controls, the future editor, map export) sees the
 * same complete bag.
 */
export function resolveParams(
  specs: ToolParamSpec[] | undefined,
  stored?: ToolParamValues,
): ToolParamValues {
  const out: ToolParamValues = {}
  for (const spec of specs ?? []) out[spec.paramKey] = spec.default
  return stored ? { ...out, ...stored } : out
}

/** Typed read of one param out of a resolved bag. */
export function getParam<K extends ParamKind>(
  values: ToolParamValues,
  spec: Extract<ToolParamSpec, { kind: K }>,
): ParamValueByKind[K] {
  return values[spec.paramKey] as ParamValueByKind[K]
}

/**
 * Whether a param control should flex-grow to fill leftover panel height (vs.
 * taking its natural height). Asset pickers grow (and split the space evenly
 * when several are present); everything else stays compact.
 */
export function paramGrows(spec: ToolParamSpec): boolean {
  return (
    spec.kind === "assetPicker" ||
    spec.kind === "biome" ||
    spec.kind === "prefabs" ||
    spec.kind === "missingAssets"
  )
}

/**
 * Exclusivity between `shape` and `editPoints`: exactly one is active. Turning
 * edit-points on clears the shape; picking a shape turns edit-points off;
 * turning edit-points off requires a shape, so it restores `defaultShape` when
 * none is selected.
 */
export const shapeVsEditPoints =
  (defaultShape: Shape): ParamNormalizer =>
  (merged, patch) => {
    if (patch.editPoints === true) return { ...merged, shape: null }
    if ("shape" in patch && patch.shape != null) return { ...merged, editPoints: false }
    if (patch.editPoints === false && merged.shape == null)
      return { ...merged, shape: defaultShape }
    return merged
  }

/**
 * Reserved param key holding the asset ids picked in the Library panel for a
 * tool that browses it (Object, Scatter, Path). It has no spec (the Library
 * panel is its control), so it isn't defaulted by `resolveParams`; read it
 * with {@link libraryAssetsOf}.
 */
export const LIBRARY_PARAM = "libraryAssets"

export function libraryAssetsOf(values: ToolParamValues): string[] {
  const v = values[LIBRARY_PARAM]
  return Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : []
}

/** A run of params as the panel lays it out: one param, or consecutive buttons sharing a row. */
export type ParamRun =
  { kind: "single"; spec: ToolParamSpec } | { kind: "buttons"; specs: ToolParamSpec[] }

/**
 * Groups consecutive command buttons (Select's Delete, Duplicate, Flip…) so
 * the panel can pack them into a compact row instead of one full-width row
 * each. Fewer than `min` in a run stay as they are.
 */
export function paramRuns(specs: ToolParamSpec[], min = 3): ParamRun[] {
  const out: ParamRun[] = []
  let run: ToolParamSpec[] = []
  const flush = () => {
    if (run.length >= min) out.push({ kind: "buttons", specs: run })
    else for (const spec of run) out.push({ kind: "single", spec })
    run = []
  }
  for (const spec of specs) {
    if (spec.kind === "button") run.push(spec)
    else {
      flush()
      out.push({ kind: "single", spec })
    }
  }
  flush()
  return out
}
