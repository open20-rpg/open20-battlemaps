import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog"
import { useMapStore } from "../../stores/mapStore"
import { useMapFileStore } from "../../stores/mapFileStore"
import { useViewStore } from "../../stores/viewStore"
import { getToolParams, useToolsStore } from "../../stores/toolsStore"
import { usePacksStore } from "../../stores/packsStore"
import { useSettingsStore } from "../../stores/settingsStore"
import { setPackEnabled } from "../packs/api"
import { TOOL_BY_ID } from "../tools/definitions"
import {
  resolveParams,
  type BiomeSelection,
  type BiomeTexture,
  type ToolParamValues,
} from "../tools/params"
import i18n from "../../i18n"
import { withLoading } from "../../stores/loadingStore"
import {
  exportBegin,
  exportEnd,
  exportEstimate,
  exportRows,
  loadMapFile,
  resolveAssets,
  saveMapFile,
} from "./api"
import { estimateBytes, FORMAT_EXTENSION } from "./exportFormat"
import { renderExportSample, renderMapRows, type ExportOptions } from "./render/exportMap"
import { loadMap } from "./commands"
import { migrateMap } from "./migrate"
import { loadCatalog } from "../fonts/catalog"
import { resolveFontNames } from "../fonts/resolve"
import {
  importDungeondraftMap,
  PATH_WIDTH_TILES,
  pathWidthMultipliers,
  type ImportResult,
  type TerrainSetup,
} from "./format/dungeondraft"
import { assetCache } from "./render/assets"
import { useEditorStore } from "../../stores/editorStore"
import { getUsedPackIds } from "./packUsage"
import type { MapDocument } from "./model/types"

/**
 * `.otbm` save format — a plain JSON envelope around the map document plus
 * enough editor state to restore the session: view toggles/zoom, any tool
 * params that differ from their defaults (kept as deltas so the file stays
 * small and forward-compatible as new tools/params are added), and the pack
 * ids the map depends on (re-enabled on open if the user has them off).
 */
export const MAP_FORMAT = "open20-battle-maps"
/** 2: labels are one line anchored at their top-left corner, fonts carry their style (migrate.ts). */
export const MAP_FORMAT_VERSION = 2
export const MAP_EXTENSION = "otbm"

const MAP_FILTERS = [{ name: "Open20 Battle Maps", extensions: [MAP_EXTENSION] }]

/** Dungeondraft maps open through the importer (read-only: saving writes `.otbm`). */
export const DUNGEONDRAFT_EXTENSION = "dungeondraft_map"

/** What "Open" accepts: both formats together first, then each on its own. */
const OPEN_FILTERS = [
  { name: "Maps", extensions: [MAP_EXTENSION, DUNGEONDRAFT_EXTENSION] },
  ...MAP_FILTERS,
  { name: "Dungeondraft Map", extensions: [DUNGEONDRAFT_EXTENSION] },
]

export interface MapFileMeta {
  /** App version the map was originally created with. */
  appVersion: string
  /** App version that produced this specific save. */
  savedWith: string
  createdAt: string
  modifiedAt: string
}

export interface MapFileView {
  grid: boolean
  snap: boolean
  lighting: boolean
  shadows: boolean
  zoom: number
}

export interface MapFile {
  format: typeof MAP_FORMAT
  formatVersion: number
  meta: MapFileMeta
  map: MapDocument
  view: MapFileView
  /** Per-tool param deltas — only params that differ from their spec default. */
  tools: Record<string, ToolParamValues>
  /** Pack ids referenced by the map (assets picked in tools/entities). */
  packs: string[]
}

export interface OpenMapResult {
  opened: boolean
  /** Pack ids the map references that aren't installed on this machine. */
  missingPacks: string[]
  /** Set when a Dungeondraft map was imported: what couldn't be carried over. */
  imported?: ImportResult["warnings"]
}

export class MapParseError extends Error {}

/** Params that differ from their tool's spec defaults, per tool id (skips untouched tools). */
function diffToolParams(
  paramsByTool: Record<string, ToolParamValues>,
): Record<string, ToolParamValues> {
  const out: Record<string, ToolParamValues> = {}
  for (const [toolId, values] of Object.entries(paramsByTool)) {
    const defaults = resolveParams(TOOL_BY_ID.get(toolId)?.params)
    const delta: ToolParamValues = {}
    for (const key of Object.keys(values)) {
      if (JSON.stringify(values[key]) !== JSON.stringify(defaults[key])) delta[key] = values[key]
    }
    if (Object.keys(delta).length > 0) out[toolId] = delta
  }
  return out
}

/** Snapshot the current session (map + view + tool deltas + used packs) into a save envelope. */
function buildSaveFile(): MapFile {
  const map = useMapStore.getState().map
  if (!map) throw new Error("No map is open")
  const { createdAt, appVersion } = useMapFileStore.getState()
  const { grid, snap, lighting, shadows, zoom } = useViewStore.getState()
  const { paramsByTool } = useToolsStore.getState()
  const now = new Date().toISOString()
  return {
    format: MAP_FORMAT,
    formatVersion: MAP_FORMAT_VERSION,
    meta: {
      appVersion: appVersion ?? __APP_VERSION__,
      savedWith: __APP_VERSION__,
      createdAt: createdAt ?? now,
      modifiedAt: now,
    },
    map,
    view: { grid, snap, lighting, shadows, zoom },
    tools: diffToolParams(paramsByTool),
    packs: [...getUsedPackIds()],
  }
}

/** Parse and shallow-validate a save file's raw JSON text. */
function parseSaveFile(raw: string): MapFile {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new MapParseError("Invalid JSON")
  }
  const file = data as Partial<MapFile> | null
  if (!file || typeof file !== "object" || file.format !== MAP_FORMAT) {
    throw new MapParseError("Not an Open20 Battle Maps map file")
  }
  if (typeof file.formatVersion !== "number" || file.formatVersion > MAP_FORMAT_VERSION) {
    throw new MapParseError("Unsupported map file version")
  }
  return file as MapFile
}

/**
 * Enable every pack the map depends on that's currently installed but
 * disabled. Returns the ids that aren't installed at all (nothing we can do
 * about those beyond letting the caller warn the user).
 */
async function enableMapPacks(packIds: string[]): Promise<string[]> {
  if (packIds.length === 0) return []
  // The pack list is loaded lazily (first AssetsManager open); make sure we
  // have it before deciding what's disabled vs. not installed at all.
  if (!usePacksStore.getState().loaded) await usePacksStore.getState().refresh()
  const installed = new Map(usePacksStore.getState().packs.map((p) => [p.id, p]))
  const missing: string[] = []
  const toEnable: string[] = []
  for (const id of packIds) {
    const pack = installed.get(id)
    if (!pack) missing.push(id)
    else if (!pack.enabled) toEnable.push(id)
  }
  if (toEnable.length > 0) {
    await Promise.all(toEnable.map((id) => setPackEnabled(id, true)))
    usePacksStore.getState().applyEnabled(toEnable, true)
  }
  return missing
}

/** Apply a parsed save file to the live stores, replacing the current session. */
async function applySaveFile(file: MapFile): Promise<string[]> {
  const { map, tools } = migrateMap(file.formatVersion, file.map, file.tools)
  loadMap(map)
  useViewStore.setState({ ...file.view })
  for (const [toolId, delta] of Object.entries(tools)) {
    useToolsStore.getState().setToolParams(toolId, delta)
  }
  return enableMapPacks(file.packs ?? [])
}

async function writeMapTo(path: string): Promise<void> {
  const file = buildSaveFile()
  await saveMapFile(path, JSON.stringify(file, null, 2))
  useMapFileStore.getState().setSaved(path)
  useSettingsStore.getState().pushRecentMap(path)
}

/** Prompt for a destination and write the current map there. False if cancelled. */
export async function saveMapAs(): Promise<boolean> {
  const path = await saveDialog({ filters: MAP_FILTERS, defaultPath: `map.${MAP_EXTENSION}` })
  if (!path) return false
  await writeMapTo(path)
  return true
}

/** Save to the remembered path, or prompt for one if the map was never saved. */
export async function saveMap(): Promise<boolean> {
  const path = useMapFileStore.getState().path
  if (path) {
    await writeMapTo(path)
    return true
  }
  return saveMapAs()
}

/**
 * Bring an imported Dungeondraft map into the session. It becomes a new,
 * unsaved document (no path), so Save asks where to write the `.otbm` and
 * the original `.dungeondraft_map` is never overwritten.
 */
async function applyImport(result: ImportResult): Promise<string[]> {
  // The map's packs first: path widths need their textures' sizes.
  const missing = await enableMapPacks(result.packs)
  const pathAssets = result.doc.entities.flatMap((e) =>
    e.params[PATH_WIDTH_TILES] !== undefined && typeof e.params.asset === "string"
      ? [e.params.asset]
      : [],
  )
  if (pathAssets.length > 0)
    await withLoading(i18n.t("loading.loadingAssets"), () => assetCache.whenLoaded(pathAssets))
  const widths = pathWidthMultipliers(result.doc.entities, (id) => assetCache.size(id)?.h)
  const fonts = resolveFontNames(widths, await loadCatalog())
  if (fonts.unknown > 0) result.warnings.unknownFonts = fonts.unknown
  loadMap({ ...result.doc, entities: fonts.entities })
  useEditorStore.getState().setActiveLevel(result.doc.levels[result.currentLevel]?.id ?? null)
  useViewStore.getState().reset()
  if (result.gridColor) {
    useToolsStore.getState().setToolParams("mapSettings", { gridLineColor: result.gridColor })
  }
  useMapFileStore.getState().startNew()
  useMapFileStore.getState().markDirty()
  if (result.terrain) await applyTerrainSetup(result.terrain)
  return missing
}

/** File name without folder or extension ("…/Grass_G_04.webp" → "Grass_G_04"). */
const stemOf = (path: string) => path.replace(/^.*[\\/|]/, "").replace(/\.[^.]+$/, "")

/**
 * Load an imported map's terrain setup into the Terrain Brush: its textures
 * fill the current biome's slots (with thumbnails resolved from the packs),
 * plus the extra-slots, smooth-blending and enabled switches.
 */
async function applyTerrainSetup(setup: TerrainSetup): Promise<void> {
  const ids = setup.slots.filter((id): id is string => !!id)
  const resolved = await withLoading(i18n.t("loading.loadingAssets"), () => resolveAssets(ids))
  const pathOf = new Map(resolved.map((r) => [r.id, r.path]))
  const slots: (BiomeTexture | null)[] = setup.slots.map((id) =>
    id ? { id, name: stemOf(id), thumb: pathOf.get(id) ?? "" } : null,
  )
  const current = getToolParams("terrainBrush").biome as BiomeSelection
  useToolsStore.getState().setToolParams("terrainBrush", {
    biome: {
      ...current,
      slotsByBiome: { ...current.slotsByBiome, [current.biome]: slots },
      unlocked: setup.expanded,
      selectedSlot: 0,
    },
    smoothBlending: setup.smoothBlending,
    enable: setup.enabled,
  })
}

/**
 * Open a map, replacing the current session: `path` when given (a recent
 * map), otherwise whatever the user picks in the open dialog. `.otbm` files
 * load as-is; `.dungeondraft_map` files go through the importer.
 */
export async function openMapFlow(path?: string): Promise<OpenMapResult> {
  const selected = path ?? (await openDialog({ filters: OPEN_FILTERS, multiple: false }))
  if (!selected || Array.isArray(selected)) return { opened: false, missingPacks: [] }
  let raw: string
  try {
    raw = await withLoading(i18n.t("loading.openingMap"), () => loadMapFile(selected))
  } catch (err) {
    // A recent entry whose file is gone shouldn't stay in the list.
    if (path) useSettingsStore.getState().removeRecentMap(path)
    throw err
  }
  if (selected.toLowerCase().endsWith(`.${DUNGEONDRAFT_EXTENSION}`)) {
    const result = importDungeondraftMap(raw)
    const missingPacks = await applyImport(result)
    useSettingsStore.getState().pushRecentMap(selected)
    return { opened: true, missingPacks, imported: result.warnings }
  }
  const file = parseSaveFile(raw)
  const missingPacks = await applySaveFile(file)
  useMapFileStore.getState().setLoaded(selected, file.meta.createdAt, file.meta.appVersion)
  useSettingsStore.getState().pushRecentMap(selected)
  return { opened: true, missingPacks }
}

/** Prompt for a destination and export the map as an image. False if cancelled. */
export async function exportImageFlow(opts: ExportOptions): Promise<boolean> {
  const ext = FORMAT_EXTENSION[opts.format.kind]
  const path = await saveDialog({
    filters: [{ name: opts.format.kind.toUpperCase(), extensions: [ext] }],
    defaultPath: `map.${ext}`,
  })
  if (!path) return false
  await withLoading(i18n.t("loading.exporting"), async () => {
    try {
      await renderMapRows(opts, (w, h) => exportBegin(path, opts.format, w, h), exportRows)
      await exportEnd()
    } catch (err) {
      await exportEnd(true)
      throw err
    }
  })
  return true
}

/** Estimated file size (bytes) of exporting with `opts`: a sample encoded the same way, scaled up. */
export function estimateExportSize(opts: ExportOptions): Promise<number> {
  return withLoading(i18n.t("loading.estimatingSize"), async () => {
    const sample = await renderExportSample(opts)
    const bytes = await exportEstimate(opts.format, sample.width, sample.height, sample.rgba)
    return estimateBytes(bytes, sample.width * sample.height, sample.imagePixels)
  })
}
