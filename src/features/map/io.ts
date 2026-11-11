import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog"
import { useMapStore } from "../../stores/mapStore"
import { useMapFileStore } from "../../stores/mapFileStore"
import { useViewStore } from "../../stores/viewStore"
import { useToolsStore } from "../../stores/toolsStore"
import { usePacksStore } from "../../stores/packsStore"
import { useSettingsStore } from "../../stores/settingsStore"
import { setPackEnabled } from "../packs/api"
import { TOOL_BY_ID } from "../tools/definitions"
import { resolveParams, type ToolParamValues } from "../tools/params"
import i18n from "../../i18n"
import { withLoading } from "../../stores/loadingStore"
import { loadMapFile, saveBinaryFile, saveMapFile } from "./api"
import { renderMapPng, type ExportOptions } from "./render/exportMap"
import { loadMap } from "./commands"
import { importDungeondraftMap, type ImportResult } from "./format/dungeondraft"
import { useEditorStore } from "../../stores/editorStore"
import { getUsedPackIds } from "./packUsage"
import type { MapDocument } from "./model/types"

/**
 * `.opdr` save format — a plain JSON envelope around the map document plus
 * enough editor state to restore the session: view toggles/zoom, any tool
 * params that differ from their defaults (kept as deltas so the file stays
 * small and forward-compatible as new tools/params are added), and the pack
 * ids the map depends on (re-enabled on open if the user has them off).
 */
export const OPDR_FORMAT = "opendraft-map"
export const OPDR_FORMAT_VERSION = 1
export const OPDR_EXTENSION = "opdr"

const OPDR_FILTERS = [{ name: "OpenDraft Map", extensions: [OPDR_EXTENSION] }]

/** Dungeondraft maps open through the importer (read-only: saving writes `.opdr`). */
export const DUNGEONDRAFT_EXTENSION = "dungeondraft_map"

/** What "Open" accepts: both formats together first, then each on its own. */
const OPEN_FILTERS = [
  { name: "Maps", extensions: [OPDR_EXTENSION, DUNGEONDRAFT_EXTENSION] },
  ...OPDR_FILTERS,
  { name: "Dungeondraft Map", extensions: [DUNGEONDRAFT_EXTENSION] },
]

export interface OpdrMeta {
  /** App version the map was originally created with. */
  appVersion: string
  /** App version that produced this specific save. */
  savedWith: string
  createdAt: string
  modifiedAt: string
}

export interface OpdrView {
  grid: boolean
  snap: boolean
  lighting: boolean
  shadows: boolean
  zoom: number
}

export interface OpdrFile {
  format: typeof OPDR_FORMAT
  formatVersion: number
  meta: OpdrMeta
  map: MapDocument
  view: OpdrView
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

export class OpdrParseError extends Error {}

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
function buildSaveFile(): OpdrFile {
  const map = useMapStore.getState().map
  if (!map) throw new Error("No map is open")
  const { createdAt, appVersion } = useMapFileStore.getState()
  const { grid, snap, lighting, shadows, zoom } = useViewStore.getState()
  const { paramsByTool } = useToolsStore.getState()
  const now = new Date().toISOString()
  return {
    format: OPDR_FORMAT,
    formatVersion: OPDR_FORMAT_VERSION,
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
function parseSaveFile(raw: string): OpdrFile {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new OpdrParseError("Invalid JSON")
  }
  const file = data as Partial<OpdrFile> | null
  if (!file || typeof file !== "object" || file.format !== OPDR_FORMAT) {
    throw new OpdrParseError("Not an OpenDraft map file")
  }
  if (typeof file.formatVersion !== "number" || file.formatVersion > OPDR_FORMAT_VERSION) {
    throw new OpdrParseError("Unsupported map file version")
  }
  return file as OpdrFile
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
async function applySaveFile(file: OpdrFile): Promise<string[]> {
  loadMap(file.map)
  useViewStore.setState({ ...file.view })
  for (const [toolId, delta] of Object.entries(file.tools)) {
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
  const path = await saveDialog({ filters: OPDR_FILTERS, defaultPath: `map.${OPDR_EXTENSION}` })
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
 * unsaved document (no path), so Save asks where to write the `.opdr` and
 * the original `.dungeondraft_map` is never overwritten.
 */
async function applyImport(result: ImportResult): Promise<string[]> {
  loadMap(result.doc)
  useEditorStore.getState().setActiveLevel(result.doc.levels[result.currentLevel]?.id ?? null)
  useViewStore.getState().reset()
  if (result.gridColor) {
    useToolsStore.getState().setToolParams("mapSettings", { gridLineColor: result.gridColor })
  }
  useMapFileStore.getState().startNew()
  useMapFileStore.getState().markDirty()
  return enableMapPacks(result.packs)
}

/**
 * Open a map, replacing the current session: `path` when given (a recent
 * map), otherwise whatever the user picks in the open dialog. `.opdr` files
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

const PNG_FILTERS = [{ name: "PNG", extensions: ["png"] }]

/** Prompt for a destination and export the map as a PNG. False if cancelled. */
export async function exportPngFlow(opts: ExportOptions): Promise<boolean> {
  const path = await saveDialog({ filters: PNG_FILTERS, defaultPath: "map.png" })
  if (!path) return false
  await withLoading(i18n.t("loading.exporting"), async () => {
    const data = await renderMapPng(opts)
    await saveBinaryFile(path, data)
  })
  return true
}
