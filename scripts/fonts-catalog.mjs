#!/usr/bin/env node
// Builds the Google Fonts catalog (src/features/fonts/catalog.json) from the
// public google/fonts repository: a partial clone fetches only the
// METADATA.pb files, and each becomes { family, dir, styles: [weight,
// italic, file] }. Variable fonts list one file per slant; their styles are
// every hundred of the wght axis. Runs before each build; without network it
// keeps the committed catalog (the build must not depend on GitHub being up).
import { execFileSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const OUT = new URL("../src/features/fonts/catalog.json", import.meta.url)
const REPO = "https://github.com/google/fonts"

/** The fields of a METADATA.pb this needs (it's protobuf text format). */
export function parseMetadata(text) {
  const family = /^name:\s*"([^"]+)"/m.exec(text)?.[1]
  const fonts = [...text.matchAll(/^fonts\s*\{([\s\S]*?)^\}/gm)].map(([, body]) => ({
    style: /style:\s*"([^"]+)"/.exec(body)?.[1] ?? "normal",
    weight: Number(/weight:\s*(\d+)/.exec(body)?.[1] ?? 400),
    filename: /filename:\s*"([^"]+)"/.exec(body)?.[1],
  }))
  const wght = /axes\s*\{\s*tag:\s*"wght"\s*min_value:\s*([\d.]+)\s*max_value:\s*([\d.]+)/.exec(
    text,
  )
  return {
    family,
    fonts: fonts.filter((f) => f.filename),
    wght: wght ? [Number(wght[1]), Number(wght[2])] : undefined,
  }
}

/** A family's styles as [weight, italic (0/1), file index], files deduplicated. */
export function familyStyles({ fonts, wght }) {
  const files = []
  const styles = []
  const seen = new Set()
  for (const f of fonts) {
    let index = files.indexOf(f.filename)
    if (index < 0) index = files.push(f.filename) - 1
    const italic = f.style === "italic" ? 1 : 0
    const variable = f.filename.includes("[") && wght
    const weights = variable
      ? Array.from({ length: 9 }, (_, i) => (i + 1) * 100).filter(
          (w) => w >= wght[0] && w <= wght[1],
        )
      : [f.weight]
    for (const w of weights) {
      const key = `${w}:${italic}`
      if (seen.has(key)) continue
      seen.add(key)
      styles.push([w, italic, index])
    }
  }
  styles.sort((a, b) => a[1] - b[1] || a[0] - b[0])
  return { files, styles }
}

function build() {
  const dir = mkdtempSync(join(tmpdir(), "gfonts-"))
  try {
    const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" })
    git("clone", "-q", "--filter=blob:none", "--no-checkout", "--depth", "1", REPO, ".")
    git("sparse-checkout", "set", "--no-cone", "/*/*/METADATA.pb")
    git("checkout", "-q")
    const families = []
    for (const license of ["ofl", "apache", "ufl"]) {
      const root = join(dir, license)
      if (!existsSync(root)) continue
      for (const name of readdirSync(root)) {
        const meta = join(root, name, "METADATA.pb")
        if (!existsSync(meta)) continue
        const parsed = parseMetadata(readFileSync(meta, "utf8"))
        if (!parsed.family || parsed.fonts.length === 0) continue
        const { files, styles } = familyStyles(parsed)
        families.push({ f: parsed.family, d: `${license}/${name}`, files, s: styles })
      }
    }
    families.sort((a, b) => a.f.localeCompare(b.f))
    return families
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const families = build()
    writeFileSync(OUT, JSON.stringify(families) + "\n")
    console.log(`fonts catalog: ${families.length} families`)
  } catch (err) {
    console.warn(`fonts catalog: kept the committed one (${err.message.split("\n")[0]})`)
  }
}
