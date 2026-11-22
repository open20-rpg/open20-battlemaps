import { describe, expect, it } from "vitest"
import { CONTRIBUTION_PERMISSIONS, runExtension } from "@open20/battlemaps-sdk"
import {
  METHOD_PERMISSIONS,
  type Endpoint,
  type HostMethod,
  type ToExtension,
  type ToHost,
} from "@open20/battlemaps-sdk/protocol"
import { type Contributes } from "@open20/battlemaps-sdk"

/**
 * The examples, together, use every capability: every host method, every
 * kind of contribution and every kind of data content. Which method or
 * contribution each `ctx.<area>.<fn>` stands for is found by calling it on
 * a context wired to a recording endpoint (so this test follows the SDK as
 * it changes); the examples' sources are then searched for those calls.
 */

const sources = import.meta.glob("./*/src/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>
const manifests = import.meta.glob("./*/manifest.json", { eager: true, import: "default" }) as Record<
  string,
  { contributes?: Contributes; optionalPermissions?: string[] }
>

/** What each context function sends: `ctx.map.add` → map.apply, `ctx.ui.panel` → contribution "panel". */
async function contextMap(): Promise<Map<string, string[]>> {
  const sent: ToHost[] = []
  const handlers = new Set<(m: ToExtension) => void>()
  const endpoint: Endpoint<ToExtension, ToHost> = {
    post: (m) => sent.push(m),
    listen: (h) => (handlers.add(h), () => handlers.delete(h)),
  }
  const run = runExtension({ activate: () => {} }, endpoint)
  for (const h of handlers)
    h({
      t: "activate",
      info: {
        manifest: { manifestVersion: 1, id: "a.b", name: "x", version: "1.0.0", author: { name: "x" }, engines: { battlemaps: "*" } },
        granted: [],
        lang: "es",
        apiVersion: "1.0.0",
        appVersion: "0",
        settings: {},
        messages: {},
        storeBuild: false,
      },
    })
  const ctx = (await run.context) as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>
  const out = new Map<string, string[]>()
  const record = (path: string, call: () => unknown) => {
    const before = sent.length
    try {
      const r = call()
      if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(() => {})
    } catch {
      // Some calls need real arguments to get as far as sending: the ones that matter don't.
    }
    const what = sent.slice(before).flatMap((m) => {
      if (m.t !== "req") return []
      if (m.method === "self.contribute")
        return [`contribution:${(m.params as { contribution: { type: string } }).contribution.type}`]
      return [m.method]
    })
    out.set(path, what)
  }
  const dummy = [{ id: "x", name: "x", title: "x", points: () => [] }, {}, {}]
  for (const [area, fns] of Object.entries(ctx)) {
    if (!fns || typeof fns !== "object") continue
    for (const [name, fn] of Object.entries(fns))
      if (typeof fn === "function") record(`${area}.${name}`, () => fn(...dummy))
  }
  for (const name of ["requestPermission", "contribute", "file", "on"])
    record(name, () => (ctx as unknown as Record<string, (...a: unknown[]) => unknown>)[name]("map.changed", () => {}))
  run.stop()
  return out
}

describe("examples cover every capability", () => {
  it("call every host method and register every kind of contribution", async () => {
    const map = await contextMap()
    const code = Object.values(sources).join("\n")
    const used = new Set<string>()
    for (const [path, what] of map) {
      const [area, fn] = path.includes(".") ? path.split(".") : ["", path]
      // `ctx.area.fn(` or `ctx.area.fn<T>(`.
      const call = area ? `ctx\\.${area}\\.${fn}` : `ctx\\.${fn}`
      const re = new RegExp(`${call}(<[^>(]*>)?\\(`)
      if (re.test(code)) for (const w of what) used.add(w)
    }
    // Methods any extension uses implicitly: subscribing to events and settings.
    if (/ctx\.(on|map\.onChange|editor\.onPointer|settings\.onChange|services\.onEvent)\(/.test(code)) {
      used.add("self.subscribe")
      used.add("self.unsubscribe")
    }
    if (/ctx\.t\(/.test(code)) used.add("self.t")
    if (/ctx\.settings\.get\(/.test(code)) used.add("self.settings")
    if (/\.dispose\(\)/.test(code)) used.add("self.withdraw")
    // What some calls do after the first message: the rest of a task, of a socket, of a proxy.
    if (used.has("ui.progress")) ["ui.progressUpdate", "ui.progressEnd"].forEach((m) => used.add(m))
    if (used.has("net.socket") && /socket\.send\(/.test(code)) used.add("net.socketSend")
    if (used.has("net.socket") && /socket\.close\(/.test(code)) used.add("net.socketClose")
    if (/ctx\.services\.use(<[^(]*>)?\(/.test(code)) used.add("services.call")
    if ([...used].some((u) => u.startsWith("contribution:"))) used.add("self.contribute")

    const methods = Object.keys(METHOD_PERMISSIONS) as HostMethod[]
    // Translated messages come with activation; settings too: no extension needs to ask.
    const implicit = new Set<HostMethod>(["self.t", "self.settings", "self.withdraw", "self.unsubscribe"])
    const missingMethods = methods.filter((m) => !used.has(m) && !implicit.has(m))
    expect(missingMethods).toEqual([])

    const types = Object.keys(CONTRIBUTION_PERMISSIONS)
    expect(types.filter((t) => !used.has(`contribution:${t}`))).toEqual([])
  })

  it("bring every kind of data content and setting", () => {
    const keys = new Set(Object.values(manifests).flatMap((m) => Object.keys(m.contributes ?? {})))
    const all: (keyof Contributes)[] = [
      "locales",
      "languagePacks",
      "keymaps",
      "toolPresets",
      "palettes",
      "postProcessPresets",
      "lightPresets",
      "prefabs",
      "templates",
      "mapSizes",
      "fonts",
      "shaders",
      "assets",
      "settings",
    ]
    expect(all.filter((k) => !keys.has(k))).toEqual([])
    const optional = Object.values(manifests).flatMap((m) => m.optionalPermissions ?? [])
    expect(optional.length).toBeGreaterThan(0)
  })

  it("exercise every permission", () => {
    const declared = new Set(
      Object.values(manifests).flatMap((m) => [
        ...((m as { permissions?: string[] }).permissions ?? []),
        ...(m.optionalPermissions ?? []),
      ]),
    )
    const needed = new Set(
      [...Object.values(METHOD_PERMISSIONS), ...Object.values(CONTRIBUTION_PERMISSIONS)].filter(
        (p): p is string => typeof p === "string" && p !== "network",
      ),
    )
    expect([...needed].filter((p) => !declared.has(p))).toEqual([])
    expect([...declared].some((p) => p.startsWith("network:"))).toBe(true)
  })
})

