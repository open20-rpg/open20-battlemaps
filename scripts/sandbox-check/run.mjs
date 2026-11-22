/**
 * Runs the extension sandbox in a real browser (Chromium via Playwright):
 * a packed example (`npm run extensions:build` first) must activate and
 * register its contributions, and a hostile extension must find every way
 * out blocked. Prints what each attempt got; exits 1 if any got through.
 *
 *   npm run sandbox:check
 */
import { resolve } from "node:path"
import { createServer } from "vite"
import { createRequire } from "node:module"
const { chromium } = createRequire(import.meta.url)("playwright")
const root = process.cwd()
const server = await createServer({
  root,
  server: { port: 5199, strictPort: true, fs: { allow: ["/"] } },
  logLevel: "error",
})
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage()
page.on("console", (m) => {
  if (m.type() === "error") console.log("console:", m.text())
})
await page.addInitScript((pkg) => {
  window.__pkg = pkg
}, resolve(process.argv[2]))
await page.goto("http://localhost:5199/scripts/sandbox-check/index.html")
await page.waitForFunction(() => window.__result?.done, null, { timeout: 30000 })
const result = await page.evaluate(() => window.__result)
console.log(JSON.stringify(result, null, 2))
const attempts = JSON.parse(result.hostile?.[0] ?? "{}")
// postMessage is the prelude's no-op and WebAssembly is allowed on purpose.
const escaped = Object.entries(attempts).filter(
  ([k, v]) => v !== "blocked" && k !== "postMessage" && k !== "wasm",
)
if (result.error || escaped.length || !result.tint?.contributions?.length) {
  console.error("sandbox check FAILED", result.error ?? escaped)
  process.exitCode = 1
}
await browser.close()
await server.close()
