import { afterEach, describe, expect, it } from "vitest"
import { API_VERSION } from "@open20/battlemaps-sdk"
import { useExtensionsStore } from "../../stores/extensionsStore"
import { activatesOn, ExtensionManager } from "./manager"
import { createHarness, type Harness } from "./testHarness"

const enc = new TextEncoder()
const files = (manifest: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Map(
    Object.entries({ "manifest.json": JSON.stringify(manifest), ...extra }).map(([k, v]) => [
      k,
      enc.encode(v),
    ]),
  )
const base = {
  manifestVersion: 1,
  id: "a.data",
  name: "Datos",
  version: "1.0.0",
  author: { name: "x" },
  engines: { battlemaps: `^${API_VERSION}` },
  contributes: { mapSizes: [{ id: "s", name: "S", width: 5, height: 5 }] },
}

let h: Harness
afterEach(() => h?.stop())

describe("extension manager", () => {
  it("refuses packages for another API and lists missing dependencies", () => {
    h = createHarness()
    const m = new ExtensionManager(h.host)
    const old = m.prepareFiles(files({ ...base, engines: { battlemaps: "^9.0.0" } }))
    expect(old.ok).toBe(false)
    const deps = m.prepareFiles(files({ ...base, dependencies: { "a.other": "^1.0.0" } }))
    expect(deps.ok && deps.prepared.warnings).toEqual(["needs extension a.other (^1.0.0)"])
  })

  it("installs, disables, re-enables and uninstalls, keeping the registry", async () => {
    h = createHarness()
    const m = new ExtensionManager(h.host)
    const check = m.prepareFiles(files(base))
    if (!check.ok) throw new Error("invalid")
    await m.install(check.prepared)
    expect(h.services.registry).toEqual([
      { id: "a.data", enabled: true, granted: [], settings: {} },
    ])
    expect(useExtensionsStore.getState().contributions).toHaveLength(1)
    await m.setEnabled("a.data", false)
    expect(useExtensionsStore.getState().contributions).toHaveLength(0)
    await m.setEnabled("a.data", true)
    expect(useExtensionsStore.getState().contributions).toHaveLength(1)
    await m.load()
    expect(Object.keys(useExtensionsStore.getState().installed)).toEqual(["a.data"])
    await m.uninstall("a.data")
    expect(h.services.registry).toEqual([])
    expect(h.services.files.has("a.data")).toBe(false)
  })

  it("asks again only for permissions an update adds, and drops undeclared ones", async () => {
    h = createHarness()
    const m = new ExtensionManager(h.host)
    const v1 = { ...base, main: "main.js", permissions: ["ui"], optionalPermissions: ["clipboard"] }
    const c1 = m.prepareFiles(files(v1, { "main.js": "" }))
    if (!c1.ok) throw new Error("invalid")
    expect(c1.prepared.newPermissions).toEqual(["ui"])
    useExtensionsStore.setState({
      installed: {
        "a.data": {
          manifest: c1.prepared.pkg.manifest,
          enabled: false,
          granted: ["ui", "clipboard"],
          settings: {},
          dev: false,
        },
      },
    })
    const c2 = m.prepareFiles(
      files(
        { ...v1, version: "1.1.0", permissions: ["ui", "map:read"], optionalPermissions: [] },
        { "main.js": "" },
      ),
    )
    if (!c2.ok) throw new Error("invalid")
    expect(c2.prepared.newPermissions).toEqual(["map:read"])
    await m.install(c2.prepared)
    expect(useExtensionsStore.getState().installed["a.data"].granted.sort()).toEqual([
      "map:read",
      "ui",
    ])
  })

  it("loads a development folder and reloads it from disk", async () => {
    h = createHarness()
    const m = new ExtensionManager(h.host)
    let version = "1.0.0"
    h.services.readDevFolder = async () => files({ ...base, version })
    expect(await m.loadDev("/dev/ext")).toEqual([])
    expect(useExtensionsStore.getState().installed["a.data"]).toMatchObject({ dev: true })
    version = "1.0.1"
    expect(await m.reloadDev("a.data")).toEqual([])
    expect(useExtensionsStore.getState().installed["a.data"].manifest.version).toBe("1.0.1")
    expect(h.services.registry[0].devPath).toBe("/dev/ext")
  })

  it("starts extensions by their activation events", () => {
    const m = { ...base } as never
    expect(activatesOn(m, "onStartup")).toBe(true)
    expect(activatesOn({ ...base, activation: ["onMapOpen"] } as never, "onStartup")).toBe(false)
    expect(activatesOn({ ...base, activation: ["onTool:x"] } as never, "onIdle")).toBe(true)
    expect(activatesOn({ ...base, activation: ["onFile:tokens"] } as never, "onFile:tokens")).toBe(
      true,
    )
  })
})
