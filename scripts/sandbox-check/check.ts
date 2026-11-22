import { HostConnection } from "@open20/battlemaps-sdk/hostkit"
import { createSandboxRuntime } from "../../src/features/extensions/runtime"
import { readPackage } from "@open20/battlemaps-sdk/package"

const result: Record<string, unknown> = {}
;(window as unknown as { __result: unknown }).__result = result

async function run(
  code: string,
  granted: string[],
  handlers: Record<string, (p: unknown) => unknown>,
) {
  const rt = createSandboxRuntime(code, "test.sandbox")
  const logs: string[] = []
  const calls: string[] = []
  const conn = new HostConnection({
    extensionId: "test.sandbox",
    endpoint: rt.endpoint,
    handlers: handlers as never,
    granted: () => granted as never,
    onLog: (_l, m) => logs.push(m),
    onRequest: (m, ok) => calls.push(`${m}:${ok}`),
  })
  conn.activate({
    manifest: {
      manifestVersion: 1,
      id: "test.sandbox",
      name: "x",
      version: "1.0.0",
      author: { name: "x" },
      engines: { battlemaps: "*" },
    },
    granted: granted as never,
    lang: "es",
    apiVersion: "1.0.0",
    appVersion: "0",
    settings: {},
    messages: {},
    storeBuild: false,
  })
  await Promise.race([conn.ready, new Promise((r) => setTimeout(r, 8000))])
  await new Promise((r) => setTimeout(r, 500))
  return { conn, rt, logs, calls }
}

const hostile = `
const out = {}
const tryIt = async (name, fn) => { try { const v = await fn(); out[name] = "ALLOWED " + String(v).slice(0, 40) } catch (e) { out[name] = "blocked" } }
const g = self
;(async () => {
  await tryIt("fetch", () => g.fetch("https://example.com"))
  await tryIt("xhr", () => { const x = new g.XMLHttpRequest(); x.open("GET", "https://example.com"); x.send(); return "sent" })
  await tryIt("websocket", () => new g.WebSocket("wss://example.com"))
  await tryIt("importScripts", () => g.importScripts("https://example.com/x.js"))
  await tryIt("indexedDB", () => g.indexedDB.open("x"))
  await tryIt("caches", () => g.caches.open("x"))
  await tryIt("broadcast", () => new g.BroadcastChannel("x"))
  await tryIt("nestedWorker", () => new g.Worker("data:,1"))
  await tryIt("eval", () => eval("1+1"))
  await tryIt("newFunction", () => new Function("return 1")())
  await tryIt("dynamicImport", () => import("https://example.com/x.js"))
  await tryIt("blobImport", () => import(URL.createObjectURL(new Blob(["export default 1"], { type: "text/javascript" }))))
  await tryIt("document", () => g.document.title)
  await tryIt("parent", () => g.parent.document)
  await tryIt("tauri", () => g.__TAURI_INTERNALS__.invoke("extensions_registry"))
  await tryIt("postMessage", () => { g.postMessage("x"); return "noop" })
  await tryIt("wasm", () => WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])).then(() => "ok"))
  g.__open20Endpoint.post({ t: "log", level: "info", message: JSON.stringify(out) })
  g.__open20Endpoint.post({ t: "ready" })
})()
`

async function main() {
  // 1. The real tint example, built and packed by the CLI.
  const bytes = new Uint8Array(
    await (await fetch("/@fs" + (window as unknown as { __pkg: string }).__pkg)).arrayBuffer(),
  )
  const pkg = await readPackage(bytes)
  if (!pkg.ok) throw new Error("bad package")
  const code = new TextDecoder().decode(pkg.pkg.files.get("main.js")!)
  const contributions: string[] = []
  const tint = await run(code, ["map:read", "map:write", "editor", "tools", "render", "ui"], {
    "self.contribute": (p) => {
      contributions.push((p as { contribution: { type: string } }).contribution.type)
      return `k${contributions.length}`
    },
  })
  result.tint = { contributions, calls: tint.calls, logs: tint.logs }
  tint.conn.close()
  tint.rt.terminate()
  // 2. A hostile extension trying every way out.
  const bad = await run(hostile, [], {})
  result.hostile = bad.logs
  result.done = true
}
main().catch((e) => {
  result.error = String(e)
  result.done = true
})
