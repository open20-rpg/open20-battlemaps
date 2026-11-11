// Sets the app version in the files semantic-release's npm plugin doesn't
// touch: tauri.conf.json, Cargo.toml and Cargo.lock (package.json and
// package-lock.json are bumped by @semantic-release/npm). All five must match.
// Usage: node scripts/bump-version.mjs <version>
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * tauri.conf.json with its top-level `version` replaced. A targeted replace
 * (not parse + stringify) keeps the file's formatting intact.
 */
export function bumpTauriConf(text, version) {
  return text.replace(/^(  "version":\s*")[^"]*(")/m, `$1${version}$2`)
}

/** Cargo.toml with the `[package]` version replaced (dependency versions untouched). */
export function bumpCargoToml(text, version) {
  return text.replace(/(\[package\][^[]*?\nversion\s*=\s*")[^"]*(")/, `$1${version}$2`)
}

/** Cargo.lock with the version of the `name = "<crate>"` entry replaced. */
export function bumpCargoLock(text, version, crate = "opendraft") {
  const re = new RegExp(`(\\[\\[package\\]\\]\\nname = "${crate}"\\nversion = ")[^"]*(")`)
  return text.replace(re, `$1${version}$2`)
}

function main() {
  const version = process.argv[2]
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
    console.error("usage: node scripts/bump-version.mjs <semver>")
    process.exit(1)
  }
  const edit = (path, fn) => writeFileSync(path, fn(readFileSync(path, "utf8"), version))
  edit("src-tauri/tauri.conf.json", bumpTauriConf)
  edit("src-tauri/Cargo.toml", bumpCargoToml)
  edit("src-tauri/Cargo.lock", bumpCargoLock)
  console.log(`version set to ${version}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
