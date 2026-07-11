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
}

export const BIOME_MAX_SLOTS = 8

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
  shape: Shape | null
  brushSize: number
  editPoints: boolean
  assetPicker: AssetSelection
  biome: BiomeSelection
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
  | (BaseSpec<"switch"> & { labelKey: string })
  /** Segmented single-choice control (Brush Mode: Dig Cave / Blast Open, …). */
  | (BaseSpec<"segmented"> & { labelKey: string; options: SegmentedChoice[] })
  /** Plain numeric slider (Rotation, …). */
  | (BaseSpec<"slider"> & { labelKey: string; min: number; max: number; step: number })
  /** Shape selector. `allowBrush` adds a free-paint "brush" option (Water Brush). */
  | (BaseSpec<"shape"> & { allowBrush: boolean })
  /** Draggable size slider, always visible and never null. */
  | (BaseSpec<"brushSize"> & { min: number; max: number; step: number })
  | BaseSpec<"editPoints">
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
  return spec.kind === "assetPicker" || spec.kind === "biome"
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
