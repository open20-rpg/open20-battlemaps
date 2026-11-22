import {
  localize,
  type Contribution,
  type FileData,
  type MapDocumentData,
  type MapOp,
} from "@open20/battlemaps-sdk"
import i18n from "../../i18n"
import { withLoading } from "../../stores/loadingStore"
import { useEditorStore } from "../../stores/editorStore"
import { useMapStore } from "../../stores/mapStore"
import { contributionsOf, type LiveContribution } from "../../stores/extensionsStore"
import { toaster } from "../../ui/chakra/toaster-instance"
import { createMap, transformDocument } from "../map/commands"
import { selectionBounds } from "../map/model/geometry"
import { extensionHost, extensionManager } from "./extensionsApp"
import { applyOps, toSdkEntity } from "./ops"
import { fileExtension } from "./services"

/**
 * What the Extensions menu, the command palette and the editor run on
 * behalf of extensions' contributions. Each wraps the extension's callback
 * in `withLoading` (it may take a while) and reports failures to the user.
 */

type Of<T extends Contribution["type"]> = LiveContribution<Extract<Contribution, { type: T }>>

const fail = (e: unknown) =>
  toaster.create({
    type: "error",
    title: i18n.t("extensions.actionFailed"),
    description: String(e instanceof Error ? e.message : e),
  })

/** Apply an extension's ops to the open map as one undo step. */
export function applyFor(extId: string, ops: MapOp[]): void {
  const map = useMapStore.getState().map
  if (!map || !Array.isArray(ops) || !ops.length) return
  const level = useEditorStore.getState().activeLevel ?? map.levels[0].id
  const result = applyOps(map, ops, extId, level)
  transformDocument(() => result.map)
}

export async function runCommand(c: Of<"command">): Promise<void> {
  try {
    await withLoading(i18n.t("extensions.loading.running"), async () => c.contribution.run())
  } catch (e) {
    fail(e)
  }
}

function selectionInfo() {
  const map = useMapStore.getState().map
  const ids = new Set(useEditorStore.getState().selection)
  const picked = map?.entities.filter((e) => ids.has(e.id)) ?? []
  return { map, picked }
}

export async function runGenerator(
  g: Of<"generator">,
  params: Record<string, unknown>,
  seed: number,
  size?: { width: number; height: number },
): Promise<void> {
  try {
    if (size) createMap(size.width, size.height)
    const { map, picked } = selectionInfo()
    if (!map) return
    const level = useEditorStore.getState().activeLevel ?? map.levels[0].id
    const box = selectionBounds(picked, () => undefined)
    const ops = await withLoading(i18n.t("extensions.loading.generating"), async () =>
      g.contribution.generate({
        params,
        seed,
        area: box,
        selection: picked.map((e) => toSdkEntity(e, g.extId, level)),
        level,
        size: size ?? { width: map.width, height: map.height },
      }),
    )
    applyFor(g.extId, ops as MapOp[])
  } catch (e) {
    fail(e)
  }
}

export async function runContextItem(c: Of<"contextMenu">): Promise<void> {
  const { map, picked } = selectionInfo()
  if (!map) return
  const pointer = useEditorStore.getState().pointer ?? { x: 0, y: 0 }
  try {
    await c.contribution.run({
      entities: picked.map((e) => toSdkEntity(e, c.extId, map.levels[0].id)),
      at: pointer,
    })
  } catch (e) {
    fail(e)
  }
}

export async function runSelectionMode(c: Of<"selectionMode">): Promise<void> {
  const { map, picked } = selectionInfo()
  if (!map) return
  try {
    const ids = await c.contribution.select(
      picked.map((e) => toSdkEntity(e, c.extId, map.levels[0].id)),
    )
    const known = new Set(map.entities.map((e) => e.id))
    useEditorStore.getState().select((Array.isArray(ids) ? ids : []).filter((id) => known.has(id)))
  } catch (e) {
    fail(e)
  }
}

/** Replace the open map with an imported one (a new, unsaved document). */
export function loadImported(extId: string, data: MapDocumentData): void {
  createMap(Math.max(1, Math.min(1000, data.width)), Math.max(1, Math.min(1000, data.height)))
  const ops: MapOp[] = [
    ...data.levels.slice(1).map((l) => ({ op: "addLevel" as const, id: l.id, name: l.name })),
    ...(data.ambientLight ? [{ op: "setAmbientLight" as const, color: data.ambientLight }] : []),
    ...(data.grid ? [{ op: "setGrid" as const, grid: data.grid }] : []),
    ...(data.data ? [{ op: "setMapData" as const, data: data.data }] : []),
    { op: "add", entities: data.entities.slice(0, 200_000) },
  ]
  applyFor(extId, ops)
}

export async function runImport(f: Of<"importFormat">): Promise<void> {
  try {
    const [file] = await extensionHost.services.pickFiles(f.contribution.extensions, false)
    if (!file) return
    const result = await withLoading(i18n.t("extensions.loading.importing"), async () =>
      f.contribution.import(file),
    )
    loadImported(f.extId, result.map)
    for (const w of (result.warnings ?? []).slice(0, 10))
      toaster.create({ type: "warning", description: w })
  } catch (e) {
    fail(e)
  }
}

export async function runExport(
  f: Of<"exportFormat">,
  options: Record<string, unknown>,
): Promise<void> {
  try {
    const file = (await withLoading(i18n.t("extensions.loading.exporting"), async () =>
      f.contribution.export({ profile: null, options }),
    )) as FileData
    if (!file?.bytes) throw new Error("the extension returned no file")
    const name = file.name?.endsWith(`.${f.contribution.extension}`)
      ? file.name
      : `mapa.${f.contribution.extension}`
    await extensionHost.services.saveFile({ ...file, name })
  } catch (e) {
    fail(e)
  }
}

export async function computeStats(): Promise<
  { title: string; rows: { label: string; value: string }[] }[]
> {
  // Every provider at once; a failing one is left out.
  const answers = await Promise.all(
    contributionsOf("stats").map(async (s) => {
      try {
        const rows = await s.contribution.compute()
        return {
          title: localize(s.contribution.title, i18n.language),
          rows: Array.isArray(rows) ? rows.slice(0, 50) : [],
        }
      } catch {
        return null
      }
    }),
  )
  return answers.filter((a) => a !== null)
}

/** A file dropped on the map: the extension that handles its type places what it holds. */
export async function dropFile(file: FileData, at: { x: number; y: number }): Promise<boolean> {
  const ext = fileExtension(file.name)
  await extensionManager.activate(`onFile:${ext}`)
  const h = contributionsOf("fileHandler").find(
    (x) => x.contribution.drop && x.contribution.extensions.includes(ext),
  )
  if (!h?.contribution.drop) return false
  try {
    const ops = await withLoading(i18n.t("extensions.loading.importing"), async () =>
      h.contribution.drop!(file, at),
    )
    applyFor(h.extId, ops as MapOp[])
  } catch (e) {
    fail(e)
  }
  return true
}

/** Open a file through the extension that registered its type. */
export async function openWithHandler(file: FileData): Promise<boolean> {
  const ext = fileExtension(file.name)
  // Extensions activated by this file type start first.
  await extensionManager.activate(`onFile:${ext}`)
  const h = contributionsOf("fileHandler").find(
    (x) => x.contribution.open && x.contribution.extensions.includes(ext),
  )
  if (!h?.contribution.open) return false
  try {
    const result = await withLoading(i18n.t("extensions.loading.importing"), async () =>
      h.contribution.open!(file),
    )
    loadImported(h.extId, result.map)
  } catch (e) {
    fail(e)
  }
  return true
}
