import { type MapDocumentData } from "@open20/battlemaps-sdk"
import i18n from "../../i18n"
import { useMapStore } from "../../stores/mapStore"
import { contributionsOf, useExtensionsStore } from "../../stores/extensionsStore"
import { satisfies } from "@open20/battlemaps-sdk/semver"
import { setDocumentHooks } from "../map/io"
import { applyFor } from "./actions"
import { extensionHost } from "./extensionsApp"

/** Extensions a map says it uses that aren't installed (or are too old), with why. */
export function missingExtensions(
  uses: readonly { id: string; version: string }[],
  installed: Record<string, { version: string; enabled: boolean }>,
): { id: string; reason: "missing" | "disabled" | "older" }[] {
  const out: { id: string; reason: "missing" | "disabled" | "older" }[] = []
  for (const u of uses) {
    const ext = installed[u.id]
    if (!ext) out.push({ id: u.id, reason: "missing" })
    else if (!ext.enabled) out.push({ id: u.id, reason: "disabled" })
    else if (!satisfies(ext.version, `>=${u.version}`)) out.push({ id: u.id, reason: "older" })
  }
  return out
}

/** The top-level keys of a JSON text (Dungeondraft maps are JSON), or null. */
function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw)
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** A map's stable view for translators (what was imported so far). */
function currentData(): MapDocumentData | null {
  const map = useMapStore.getState().map
  if (!map) return null
  return {
    width: map.width,
    height: map.height,
    levels: map.levels.map((l) => ({ id: l.id, name: l.name })),
    entities: [],
  }
}

export function installDocumentHooks(): () => void {
  setDocumentHooks({
    beforeSave: () => extensionHost.documentHooks("beforeSave"),
    afterOpen: async () => {
      const map = useMapStore.getState().map
      const installed = Object.fromEntries(
        Object.values(useExtensionsStore.getState().installed).map((e) => [
          e.manifest.id,
          { version: e.manifest.version, enabled: e.enabled },
        ]),
      )
      const missing = missingExtensions(map?.extensions ?? [], installed).map((m) =>
        i18n.t(`extensions.mapNeeds.${m.reason}`, { id: m.id }),
      )
      return [...missing, ...(await extensionHost.documentHooks("afterOpen"))]
    },
    dungeondraft: async (raw) => {
      const translators = contributionsOf("dungeondraftTranslator")
      if (!translators.length) return []
      const json = parseJson(raw)
      const data = currentData()
      if (!json || !data) return []
      const warnings: string[] = []
      for (const t of translators) {
        const picked = Object.fromEntries(
          t.contribution.handles.filter((k) => k in json).map((k) => [k, json[k]]),
        )
        if (!Object.keys(picked).length) continue
        try {
          const res = await t.contribution.translate(picked, data)
          if (res?.entities?.length) applyFor(t.extId, [{ op: "add", entities: res.entities }])
          warnings.push(...(res?.warnings ?? []).slice(0, 10))
        } catch {
          // A failing translator leaves the import as it was.
        }
      }
      return warnings
    },
  })
  return () => setDocumentHooks(null)
}
