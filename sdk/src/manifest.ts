import { isPermission, type Permission } from "./permissions"
import { isRange, parseVersion } from "./semver"

/** The version of the extension API this SDK speaks (host and extensions check it). */
export const API_VERSION = "1.0.0"

/** Text shown to the user: plain, or one per language (`es` is the reference). */
export type LocalizedText = string | { es: string; en?: string; [lang: string]: string | undefined }

/**
 * When the host loads an extension's code. Loading on demand keeps the app's
 * start fast: most extensions only need to run once their tool is used or
 * their file type is opened.
 */
export type ActivationEvent =
  | "onStartup"
  | "onMapOpen"
  | `onTool:${string}`
  | `onCommand:${string}`
  | `onFile:${string}`
  | `onService:${string}`

/** A setting of the extension, shown in its page (values are kept per extension). */
export type SettingSpec =
  | { type: "boolean"; label: LocalizedText; default: boolean }
  | {
      type: "number"
      label: LocalizedText
      default: number
      min?: number
      max?: number
      step?: number
    }
  | { type: "string"; label: LocalizedText; default: string; maxLength?: number }
  | { type: "color"; label: LocalizedText; default: string }
  | {
      type: "select"
      label: LocalizedText
      default: string
      options: { value: string; label: LocalizedText }[]
    }

/** What a shader contributed as data can be applied to. */
export type ShaderTarget = "entity" | "layer" | "post" | "fill"

export type UniformType = "float" | "vec2" | "vec3" | "vec4" | "color" | "bool" | "texture"

export interface UniformSpec {
  type: UniformType
  /** Number(s) for numeric types, `#rrggbb` for colors, a bundled image path for textures. */
  default?: number | number[] | string | boolean
}

/**
 * Content an extension brings as plain data: no code runs for it, so a
 * data-only extension (no `main`) installs without asking permissions.
 * Paths are relative to the extension's root.
 */
export interface Contributes {
  /** The extension's own translations (`{ "es": "locales/es.json", … }`). */
  locales?: Record<string, string>
  /** Translations of the whole app into a new language. */
  languagePacks?: { lang: string; name: string; path: string }[]
  /** Keyboard schemes ("Dungeondraft style"…): action id → key combo. */
  keymaps?: { id: string; name: LocalizedText; path: string }[]
  /** Saved tool params, by tool id. */
  toolPresets?: { id: string; tool: string; name: LocalizedText; params: Record<string, unknown> }[]
  palettes?: { id: string; name: LocalizedText; colors: string[] }[]
  postProcessPresets?: { id: string; name: LocalizedText; values: Record<string, unknown> }[]
  lightPresets?: { id: string; name: LocalizedText; params: Record<string, unknown> }[]
  /** Prefabs (a JSON list of entities, as the Prefabs tool saves them). */
  prefabs?: { id: string; name: LocalizedText; path: string }[]
  /** Map templates (`.otbm` files) offered when creating a map. */
  templates?: { id: string; name: LocalizedText; path: string }[]
  /** New-map size presets. */
  mapSizes?: { id: string; name: LocalizedText; width: number; height: number }[]
  /** Fonts bundled with the extension, with their license. */
  fonts?: { family: string; path: string; style?: string; license: string }[]
  shaders?: {
    id: string
    name: LocalizedText
    target: ShaderTarget
    path: string
    uniforms?: Record<string, UniformSpec>
  }[]
  /** Folder with the images the extension uses (`ext:<id>/<file>` asset ids). */
  assets?: string
  settings?: Record<string, SettingSpec>
}

export interface Manifest {
  manifestVersion: 1
  /** Unique id: lowercase segments separated by dots (`autor.nombre`). */
  id: string
  name: LocalizedText
  version: string
  description?: LocalizedText
  author: { name: string; url?: string }
  license?: string
  homepage?: string
  /** Where users report problems (opened in the browser, after asking). */
  issues?: string
  /** Range of the extension API it works with (`^1.0.0`). */
  engines: { battlemaps: string }
  /** The extension's code (a single script). Without it, the extension is data-only. */
  main?: string
  permissions?: Permission[]
  /** Asked only when the extension needs them, at that moment. */
  optionalPermissions?: Permission[]
  activation?: ActivationEvent[]
  /** Other extensions it uses (their services), by id → version range. */
  dependencies?: Record<string, string>
  contributes?: Contributes
}

export interface ManifestIssue {
  path: string
  message: string
}

export type ManifestResult =
  { ok: true; manifest: Manifest } | { ok: false; issues: ManifestIssue[] }

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/
const ACTIVATION_RE = /^(onStartup|onMapOpen|on(Tool|Command|File|Service):[A-Za-z0-9._/-]+)$/
/** A path inside the extension: relative, no `..`, no absolute or URL. */
const SAFE_PATH_RE = /^(?!\/)(?![a-zA-Z]+:)(?!.*(^|\/)\.\.(\/|$))[^\\\0]+$/

export const isExtensionId = (id: unknown): id is string =>
  typeof id === "string" && id.length <= 100 && ID_RE.test(id)

export const isSafePath = (p: unknown): p is string =>
  typeof p === "string" && p.length <= 300 && SAFE_PATH_RE.test(p)

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

function isLocalized(v: unknown): v is LocalizedText {
  if (typeof v === "string") return v.length > 0
  return (
    isObject(v) && typeof v.es === "string" && Object.values(v).every((x) => typeof x === "string")
  )
}

/** Resolve a localized text for `lang`, falling back to Spanish (the reference). */
export function localize(text: LocalizedText | undefined, lang: string): string {
  if (text === undefined) return ""
  if (typeof text === "string") return text
  return text[lang] ?? text[lang.split("-")[0]] ?? text.es
}

/**
 * Validate an untrusted manifest. It never throws: every problem is listed
 * with its path, so a broken extension says what's wrong instead of failing
 * to install with a generic error.
 */
export function validateManifest(raw: unknown): ManifestResult {
  const issues: ManifestIssue[] = []
  const issue = (path: string, message: string) => issues.push({ path, message })
  if (!isObject(raw)) return { ok: false, issues: [{ path: "", message: "not an object" }] }
  const m = raw

  if (m.manifestVersion !== 1) issue("manifestVersion", "must be 1")
  if (!isExtensionId(m.id)) issue("id", "lowercase segments separated by dots (autor.nombre)")
  if (!isLocalized(m.name)) issue("name", "required text")
  if (typeof m.version !== "string" || !parseVersion(m.version))
    issue("version", "MAJOR.MINOR.PATCH")
  if (m.description !== undefined && !isLocalized(m.description))
    issue("description", "must be text")
  if (!isObject(m.author) || typeof m.author.name !== "string" || !m.author.name)
    issue("author.name", "required")
  for (const key of ["homepage", "issues"] as const) {
    const url = m[key]
    if (url !== undefined && !(typeof url === "string" && /^https:\/\/[^\s]+$/.test(url)))
      issue(key, "must be an https URL")
  }
  if (
    !isObject(m.engines) ||
    typeof m.engines.battlemaps !== "string" ||
    !isRange(m.engines.battlemaps)
  )
    issue("engines.battlemaps", "a version range (^1.0.0)")
  if (m.main !== undefined && !(isSafePath(m.main) && /\.(js|cjs)$/.test(m.main)))
    issue("main", "a relative .js path inside the extension")

  for (const key of ["permissions", "optionalPermissions"] as const) {
    const list = m[key]
    if (list === undefined) continue
    if (!Array.isArray(list)) issue(key, "must be a list")
    else
      list.forEach((p, i) => {
        if (!isPermission(p)) issue(`${key}[${i}]`, `unknown permission ${JSON.stringify(p)}`)
      })
  }
  if (Array.isArray(m.permissions) && m.permissions.length > 0 && m.main === undefined)
    issue("permissions", "data-only extensions (no main) can't ask for permissions")

  if (m.activation !== undefined) {
    if (!Array.isArray(m.activation)) issue("activation", "must be a list")
    else
      m.activation.forEach((a, i) => {
        if (typeof a !== "string" || !ACTIVATION_RE.test(a))
          issue(`activation[${i}]`, "unknown activation event")
      })
  }
  if (m.dependencies !== undefined) {
    if (!isObject(m.dependencies)) issue("dependencies", "must be an object")
    else
      for (const [id, range] of Object.entries(m.dependencies)) {
        if (!isExtensionId(id)) issue(`dependencies.${id}`, "not an extension id")
        if (typeof range !== "string" || !isRange(range))
          issue(`dependencies.${id}`, "a version range")
      }
  }
  if (m.contributes !== undefined) validateContributes(m.contributes, issue)

  return issues.length ? { ok: false, issues } : { ok: true, manifest: m as unknown as Manifest }
}

function validateContributes(c: unknown, issue: (path: string, message: string) => void): void {
  if (!isObject(c)) return issue("contributes", "must be an object")
  const pathsIn = (key: string, list: unknown, field = "path") => {
    if (list === undefined) return
    if (!Array.isArray(list)) return issue(`contributes.${key}`, "must be a list")
    list.forEach((item, i) => {
      if (!isObject(item) || !isSafePath(item[field]))
        issue(`contributes.${key}[${i}].${field}`, "a relative path inside the extension")
    })
  }
  pathsIn("languagePacks", c.languagePacks)
  pathsIn("keymaps", c.keymaps)
  pathsIn("prefabs", c.prefabs)
  pathsIn("templates", c.templates)
  pathsIn("fonts", c.fonts)
  pathsIn("shaders", c.shaders)
  if (c.locales !== undefined) {
    if (!isObject(c.locales)) issue("contributes.locales", "must be an object")
    else
      for (const [lang, p] of Object.entries(c.locales))
        if (!isSafePath(p)) issue(`contributes.locales.${lang}`, "a relative path")
  }
  if (c.assets !== undefined && !isSafePath(c.assets))
    issue("contributes.assets", "a relative folder path")
  if (Array.isArray(c.fonts))
    c.fonts.forEach((f, i) => {
      if (isObject(f) && (typeof f.license !== "string" || !f.license))
        issue(`contributes.fonts[${i}].license`, "required")
    })
  if (Array.isArray(c.shaders))
    c.shaders.forEach((s, i) => {
      if (isObject(s) && !["entity", "layer", "post", "fill"].includes(s.target as string))
        issue(`contributes.shaders[${i}].target`, "entity, layer, post or fill")
    })
  if (c.settings !== undefined) {
    if (!isObject(c.settings)) issue("contributes.settings", "must be an object")
    else
      for (const [key, s] of Object.entries(c.settings)) {
        const types = ["boolean", "number", "string", "color", "select"]
        if (!isObject(s) || !types.includes(s.type as string) || !isLocalized(s.label))
          issue(`contributes.settings.${key}`, "needs a type and a label")
      }
  }
}

/** Every permission an extension may end up holding (required + optional). */
export function declaredPermissions(m: Manifest): Permission[] {
  return [...(m.permissions ?? []), ...(m.optionalPermissions ?? [])]
}
