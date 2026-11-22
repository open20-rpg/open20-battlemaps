#!/usr/bin/env node
/**
 * otbx — build and pack Open20 Battle Maps extensions.
 *
 *   otbx create <dir> <id>     a new extension from the template
 *   otbx validate <dir>        check the manifest and the files it names
 *   otbx build <dir>... [--out <dir>]
 *                              bundle src/main.ts into main.js and pack the
 *                              extension as <id>-<version>.otbx
 *
 * The package holds manifest.json, the bundled main.js and every other file
 * of the folder except sources, tests and build output. Bundling uses Vite
 * (an IIFE with the SDK inside: extensions run as one script, no imports),
 * and the package rules are the SDK's own (package.ts), the same the app
 * checks when installing.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const SDK = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SKIP_DIRS = new Set(["src", "dist", "node_modules"])
const SKIP_FILE = /(\.test\.ts|\.d\.ts|^\..*|tsconfig\.json|package(-lock)?\.json|README\.md)$/

function fail(message) {
  console.error(`otbx: ${message}`)
  process.exit(1)
}

/** The SDK's own TypeScript modules, loaded through Vite (no separate build of the SDK). */
async function sdkModules() {
  const { createServer } = await import("vite")
  const server = await createServer({
    configFile: false,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  })
  const pkg = await server.ssrLoadModule(join(SDK, "src/package.ts"))
  return { pkg, close: () => server.close() }
}

/** Every file of an extension folder that goes in its package (relative paths, `/`). */
async function packageFiles(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (dir === base && SKIP_DIRS.has(entry.name)) continue
      if (entry.name.startsWith(".")) continue
      out.push(...(await packageFiles(full, base)))
    } else if (!SKIP_FILE.test(entry.name) && !entry.name.endsWith(".ts")) {
      out.push(relative(base, full).split(sep).join("/"))
    }
  }
  return out
}

async function bundle(dir) {
  const entry = join(dir, "src", "main.ts")
  try {
    await stat(entry)
  } catch {
    return null
  }
  const { build } = await import("vite")
  const outDir = join(dir, "dist")
  await build({
    configFile: false,
    logLevel: "warn",
    resolve: {
      alias: [
        { find: /^@open20\/battlemaps-sdk\/(.*)$/, replacement: join(SDK, "src/$1.ts") },
        { find: /^@open20\/battlemaps-sdk$/, replacement: join(SDK, "src/index.ts") },
      ],
    },
    build: {
      lib: { entry, formats: ["iife"], name: "open20Extension", fileName: () => "main.js" },
      outDir,
      emptyOutDir: true,
      minify: true,
      sourcemap: false,
      // Exports are irrelevant: the script runs `defineExtension` when loaded.
      rollupOptions: { output: { exports: "named" } },
    },
  })
  return readFile(join(outDir, "main.js"))
}

async function collect(dir, mainJs) {
  const files = new Map()
  for (const path of await packageFiles(dir))
    files.set(path, new Uint8Array(await readFile(join(dir, path))))
  if (mainJs) files.set("main.js", new Uint8Array(mainJs))
  return files
}

async function validate(dir, pkg) {
  const files = await collect(dir, Buffer.from("/* not built */"))
  const result = pkg.checkFiles(files)
  if (!result.ok) {
    for (const i of result.issues) console.error(`  ${i.path}: ${i.message}`)
    return false
  }
  return true
}

async function buildOne(dir, outDir, pkg) {
  const mainJs = await bundle(dir)
  const files = await collect(dir, mainJs)
  const result = pkg.checkFiles(files)
  if (!result.ok) {
    for (const i of result.issues) console.error(`  ${i.path}: ${i.message}`)
    fail(`${dir} isn't a valid extension`)
  }
  const { manifest } = result.pkg
  const bytes = await pkg.writePackage(result.pkg)
  // The package must read back exactly as the app will read it.
  const back = await pkg.readPackage(bytes)
  if (!back.ok) fail(`${manifest.id}: the package doesn't read back`)
  await mkdir(outDir, { recursive: true })
  const out = join(outDir, `${manifest.id}-${manifest.version}.otbx`)
  await writeFile(out, bytes)
  await rm(join(dir, "dist"), { recursive: true, force: true })
  console.log(`${out}  (${files.size} files, ${(bytes.length / 1024).toFixed(1)} KB)`)
}

const TEMPLATE = (id) => ({
  "manifest.json": JSON.stringify(
    {
      manifestVersion: 1,
      id,
      name: { es: "Mi extensión", en: "My extension" },
      version: "0.1.0",
      author: { name: "" },
      engines: { battlemaps: "^1.0.0" },
      main: "main.js",
      permissions: ["ui"],
    },
    null,
    2,
  ),
  "src/main.ts": `import { defineExtension } from "@open20/battlemaps-sdk"

export default defineExtension({
  async activate(ctx) {
    await ctx.ui.command({
      id: "hello",
      title: { es: "Hola", en: "Hello" },
      run: () => ctx.ui.notify("¡Hola desde ${id}!"),
    })
  },
})
`,
  "src/main.test.ts": `import { expect, it } from "vitest"
import { createTestHost } from "@open20/battlemaps-sdk/testing"
import ext from "./main"

it("says hello", async () => {
  const host = createTestHost({ permissions: ["ui"] })
  await host.load(ext)
  await host.contribution("command", "hello").run()
  expect(host.notifications).toHaveLength(1)
})
`,
})

const [command, ...args] = process.argv.slice(2)
const outFlag = args.indexOf("--out")
const outDir = outFlag >= 0 ? resolve(args[outFlag + 1]) : resolve("dist-extensions")
const dirs = args.filter((a, i) => a !== "--out" && i !== outFlag + 1).map((d) => resolve(d))

if (command === "create") {
  const [dir, id] = args
  if (!dir || !id) fail("usage: otbx create <dir> <id>")
  for (const [path, text] of Object.entries(TEMPLATE(id))) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), text)
  }
  console.log(`created ${dir}`)
} else if (command === "validate" || command === "build") {
  if (!dirs.length) fail(`usage: otbx ${command} <dir>...`)
  const { pkg, close } = await sdkModules()
  try {
    let ok = true
    for (const dir of dirs) {
      try {
        await stat(join(dir, "manifest.json"))
      } catch {
        continue
      }
      if (command === "validate") {
        const valid = await validate(dir, pkg)
        console.log(`${basename(dir)}: ${valid ? "ok" : "invalid"}`)
        ok &&= valid
      } else await buildOne(dir, outDir, pkg)
    }
    if (!ok) process.exitCode = 1
  } finally {
    await close()
  }
} else {
  console.log("usage: otbx <create|validate|build> …")
  process.exitCode = command ? 1 : 0
}
