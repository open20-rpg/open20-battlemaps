/**
 * `.otbx` packages: a zip with `manifest.json` at the root plus the files it
 * references. Shared by the app (installing) and the CLI (packing), so both
 * accept exactly the same packages.
 */
import { isSafePath, validateManifest, type Manifest, type ManifestIssue } from "./manifest"
import { readZip, writeZip, type ZipEntry } from "./zip"

export const PACKAGE_EXTENSION = "otbx"

export interface ExtensionPackage {
  manifest: Manifest
  files: Map<string, Uint8Array>
}

export type PackageResult =
  { ok: true; pkg: ExtensionPackage } | { ok: false; issues: ManifestIssue[] }

/** Paths the manifest says must exist in the package. */
export function referencedPaths(m: Manifest): string[] {
  const c = m.contributes ?? {}
  return [
    ...(m.main ? [m.main] : []),
    ...Object.values(c.locales ?? {}),
    ...(c.languagePacks ?? []).map((x) => x.path),
    ...(c.keymaps ?? []).map((x) => x.path),
    ...(c.prefabs ?? []).map((x) => x.path),
    ...(c.templates ?? []).map((x) => x.path),
    ...(c.fonts ?? []).map((x) => x.path),
    ...(c.shaders ?? []).map((x) => x.path),
  ]
}

/** Check a set of files as a package: a valid manifest and every file it names. */
export function checkFiles(files: Map<string, Uint8Array>): PackageResult {
  const raw = files.get("manifest.json")
  if (!raw) return { ok: false, issues: [{ path: "manifest.json", message: "missing" }] }
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return { ok: false, issues: [{ path: "manifest.json", message: "not valid JSON" }] }
  }
  const result = validateManifest(json)
  if (!result.ok) return result
  const issues: ManifestIssue[] = []
  for (const path of files.keys())
    if (!isSafePath(path)) issues.push({ path, message: "unsafe file path" })
  for (const path of referencedPaths(result.manifest))
    if (!files.has(path)) issues.push({ path, message: "referenced but missing" })
  return issues.length
    ? { ok: false, issues }
    : { ok: true, pkg: { manifest: result.manifest, files } }
}

export async function readPackage(bytes: Uint8Array): Promise<PackageResult> {
  let entries: ZipEntry[]
  try {
    entries = await readZip(bytes)
  } catch (e) {
    return {
      ok: false,
      issues: [{ path: "", message: e instanceof Error ? e.message : String(e) }],
    }
  }
  return checkFiles(new Map(entries.map((e) => [e.path, e.bytes])))
}

export function writePackage(pkg: ExtensionPackage): Promise<Uint8Array> {
  const entries = [...pkg.files.entries()]
    .sort(([a], [b]) =>
      a === "manifest.json" ? -1 : b === "manifest.json" ? 1 : a.localeCompare(b),
    )
    .map(([path, bytes]) => ({ path, bytes }))
  return writeZip(entries)
}
