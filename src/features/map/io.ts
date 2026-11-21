import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog"
import { useMapStore } from "../../stores/mapStore"
import { useMapFileStore } from "../../stores/mapFileStore"
import { useViewStore } from "../../stores/viewStore"
import { getToolParams, useToolsStore } from "../../stores/toolsStore"
import { usePacksStore } from "../../stores/packsStore"
import { useSettingsStore } from "../../stores/settingsStore"
import { setPacksEnabled } from "../packs/api"
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
import {
  renderExportSample,
  renderMapRows,
  renderThumbnail,
  type ExportOptions,
} from "./render/exportMap"
import { createMap, loadMap } from "./commands"
import { seedNewMapTerrain } from "../tools/behaviors/paint"
import { migrateMap } from "./migrate"
import { leadingJsonValue } from "../../lib/jsonPrefix"
import { mapFileName } from "../../lib/mapName"
import { readBackup, writeBackup, type BackupEntry } from "../backups/api"
import { loadCatalog } from "../fonts/catalog"
import { resolveFontNames } from "../fonts/resolve"
import {
  importDungeondraftMap,
  looksLikeDungeondraftMap,
  PATH_WIDTH_TILES,
  pathWidthMultipliers,
  type ImportResult,
  type TerrainSetup,
} from "./format/dungeondraft"
import { assetCache } from "./render/assets"
import { useEditorStore } from "../../stores/editorStore"
import { getUsedPackIds } from "./packUsage"
import { collectAssetIds } from "./missingAssets"
import type { MapDocument } from "./model/types"

/**
 * `.otbm` save format — a plain JSON envelope around the map document plus
 * enough editor state to restore the session: view toggles/zoom, any tool
 * params that differ from their defaults (kept as deltas so the file stays
 * small and forward-compatible as new tools/params are added), and the pack
 * ids the map depends on (re-enabled on open if the user has them off).
 */
export const MAP_FORMAT = "open20-battle-maps"
/**
 * 2: labels are one line anchored at their top-left corner, fonts carry
 * their style. 3: floors' and patterns' textures are laid from their
 * position (migrate.ts).
 */
export const MAP_FORMAT_VERSION = 3
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
  /** The map's own id, kept across saves: its backups are grouped by it. */
  id?: string
  /** A small picture of the map (JPEG `data:` URL), for lists of maps. */
  thumbnail?: string
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
  /**
   * The file had leftover bytes after the map (see `parseSaveFile`): "saved"
   * once the file was rewritten, "pending" if that failed (the next save fixes it).
   */
  repaired?: "saved" | "pending"
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
function buildSaveFile(thumbnail: string | null): MapFile {
  const map = useMapStore.getState().map
  if (!map) throw new Error("No map is open")
  const { createdAt, appVersion, mapId } = useMapFileStore.getState()
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
      ...(mapId ? { id: mapId } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    },
    map,
    view: { grid, snap, lighting, shadows, zoom },
    tools: diffToolParams(paramsByTool),
    packs: [...getUsedPackIds()],
  }
}

/**
 * Parse and shallow-validate a save file's raw JSON text. A file with
 * leftover bytes after the map (an overwrite that didn't truncate the
 * previous, longer save — Android before the fix) still opens: the map comes
 * first and is complete. `repaired` is then the text the file should hold.
 */
function parseSaveFile(raw: string): { file: MapFile; repaired?: string } {
  const whole = tryParseJson(raw)
  if (whole.ok) return { file: validateSaveFile(whole.value) }
  const prefix = leadingJsonValue(raw)
  const recovered = prefix === null ? whole : tryParseJson(prefix)
  if (!recovered.ok) throw new MapParseError("Invalid JSON")
  return { file: validateSaveFile(recovered.value), repaired: `${prefix}\n` }
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

function validateSaveFile(data: unknown): MapFile {
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
    await withLoading(i18n.t("loading.updatingPacks"), () => setPacksEnabled(toEnable, true))
    usePacksStore.getState().applyEnabled(toEnable, true)
  }
  return missing
}

/**
 * Look up every asset the map uses, not just the active level's (those get
 * looked up as they're drawn): the tools bar tells right away if any is
 * missing (Replace Assets).
 */
function prefetchAssets(map: MapDocument): void {
  assetCache.prefetch(collectAssetIds(map.entities))
}

/** Apply a parsed save file to the live stores, replacing the current session. */
async function applySaveFile(file: MapFile): Promise<string[]> {
  const { map, tools } = migrateMap(file.formatVersion, file.map, file.tools)
  loadMap(map)
  prefetchAssets(map)
  useViewStore.setState({ ...file.view })
  for (const [toolId, delta] of Object.entries(tools)) {
    useToolsStore.getState().setToolParams(toolId, delta)
  }
  return enableMapPacks(file.packs ?? [])
}

/** The open map's thumbnail; null when it can't be drawn (it's only a nicety). */
async function currentThumbnail(): Promise<string | null> {
  const { lighting, shadows } = useViewStore.getState()
  return renderThumbnail({ lighting, shadows }).catch(() => null)
}

/** The open map's name in lists: its file's, or "Untitled" before its first save. */
export function currentMapName(): string {
  const path = useMapFileStore.getState().path
  return path ? mapFileName(path) : i18n.t("backups.untitled")
}

/** The open map, ready to write, and its thumbnail. */
async function serializeCurrentMap(): Promise<{ contents: string; thumbnail: string | null }> {
  const thumbnail = await currentThumbnail()
  return { contents: JSON.stringify(buildSaveFile(thumbnail), null, 2), thumbnail }
}

/**
 * Store a backup of the open map (see `features/backups`). `unsaved`: it
 * has changes its file doesn't. False without a map to back up.
 */
export async function backupCurrentMap(unsaved: boolean): Promise<boolean> {
  const { mapId, path } = useMapFileStore.getState()
  if (!mapId || !useMapStore.getState().map) return false
  const { contents, thumbnail } = await serializeCurrentMap()
  return backupSerialized(mapId, path, contents, thumbnail, unsaved)
}

async function backupSerialized(
  mapId: string,
  path: string | null,
  contents: string,
  thumbnail: string | null,
  unsaved: boolean,
): Promise<boolean> {
  const name = path ? mapFileName(path) : i18n.t("backups.untitled")
  await writeBackup(mapId, contents, { name, sourcePath: path, unsaved, thumbnail })
  return true
}

async function writeMapTo(path: string): Promise<void> {
  const { contents, thumbnail } = await serializeCurrentMap()
  await saveMapFile(path, contents)
  useMapFileStore.getState().setSaved(path)
  useSettingsStore.getState().pushRecentMap(path, thumbnail)
  // What was just saved is a backup too (the newest, with nothing unsaved).
  const mapId = useMapFileStore.getState().mapId
  if (mapId) void backupSerialized(mapId, path, contents, thumbnail, false).catch(() => undefined)
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
  prefetchAssets(result.doc)
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
  // By extension, or by content when the path has no name (an Android content:// URI).
  if (
    selected.toLowerCase().endsWith(`.${DUNGEONDRAFT_EXTENSION}`) ||
    looksLikeDungeondraftMap(raw)
  ) {
    const result = importDungeondraftMap(raw)
    const missingPacks = await applyImport(result)
    useSettingsStore.getState().pushRecentMap(selected)
    return { opened: true, missingPacks, imported: result.warnings }
  }
  const { file, repaired } = parseSaveFile(raw)
  const missingPacks = await applySaveFile(file)
  useMapFileStore
    .getState()
    .setLoaded(selected, file.meta.createdAt, file.meta.appVersion, file.meta.id)
  useSettingsStore.getState().pushRecentMap(selected, file.meta.thumbnail)
  if (repaired === undefined) return { opened: true, missingPacks }
  // Rewrite exactly the recovered text (what the last save wrote). If that
  // fails the map is still open; left unsaved, the next save fixes it.
  try {
    await withLoading(i18n.t("loading.repairingMap"), () => saveMapFile(selected, repaired))
    return { opened: true, missingPacks, repaired: "saved" }
  } catch {
    useMapFileStore.getState().markDirty()
    return { opened: true, missingPacks, repaired: "pending" }
  }
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

/**
 * Start a new map. Its ground then gets the built-in terrain (when that pack
 * is enabled), in the background: best effort, the map is usable meanwhile.
 */
export function newMapFlow(...args: Parameters<typeof createMap>): void {
  createMap(...args)
  void seedNewMapTerrain().catch(() => undefined)
}

/**
 * Open a backup in place of the current map. It keeps its map's identity
 * and file (Save writes over that file), but counts as unsaved: until it's
 * saved, the file still holds what it had.
 */
export async function restoreBackupFlow(mapId: string, backup: BackupEntry): Promise<string[]> {
  const raw = await withLoading(i18n.t("loading.restoringBackup"), () =>
    readBackup(mapId, backup.id),
  )
  const { file } = parseSaveFile(raw)
  const missingPacks = await applySaveFile(file)
  useMapFileStore
    .getState()
    .setLoaded(backup.sourcePath, file.meta.createdAt, file.meta.appVersion, mapId)
  useMapFileStore.getState().markDirty()
  return missingPacks
}
