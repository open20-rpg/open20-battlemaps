import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"
import { useMapStore } from "../../stores/mapStore"
import { useMapFileStore } from "../../stores/mapFileStore"
import { useViewStore } from "../../stores/viewStore"
import { useToolsStore } from "../../stores/toolsStore"
import { TOOL_BY_ID } from "../tools/definitions"
import { resolveParams, type ToolParamValues } from "../tools/params"
import { loadMap } from "./commands"
import type { MapDocument } from "./model/types"

/**
 * `.opdr` save format — a plain JSON envelope around the map document plus
 * enough editor state to restore the session: view toggles/zoom and any tool
 * params that differ from their defaults (kept as deltas so the file stays
 * small and forward-compatible as new tools/params are added).
 */
export const OPDR_FORMAT = "opendraft-map"
export const OPDR_FORMAT_VERSION = 1
export const OPDR_EXTENSION = "opdr"

const OPDR_FILTERS = [{ name: "OpenDraft Map", extensions: [OPDR_EXTENSION] }]

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

/** Snapshot the current session (map + view + tool deltas) into a save envelope. */
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

/** Apply a parsed save file to the live stores, replacing the current session. */
function applySaveFile(file: OpdrFile): void {
  loadMap(file.map)
  useViewStore.setState({ ...file.view })
  for (const [toolId, delta] of Object.entries(file.tools)) {
    useToolsStore.getState().setToolParams(toolId, delta)
  }
}

async function writeMapTo(path: string): Promise<void> {
  const file = buildSaveFile()
  await invoke("save_map", { path, contents: JSON.stringify(file, null, 2) })
  useMapFileStore.getState().setSaved(path)
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

/** Prompt for a `.opdr` file and load it, replacing the current session. False if cancelled. */
export async function openMapFlow(): Promise<boolean> {
  const selected = await openDialog({ filters: OPDR_FILTERS, multiple: false })
  if (!selected || Array.isArray(selected)) return false
  const raw = await invoke<string>("load_map", { path: selected })
  const file = parseSaveFile(raw)
  applySaveFile(file)
  useMapFileStore.getState().setLoaded(selected, file.meta.createdAt, file.meta.appVersion)
  return true
}
