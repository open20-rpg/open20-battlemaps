/**
 * The permissions an extension can ask for. Each one gates a set of host
 * methods (see `METHOD_PERMISSIONS` in protocol.ts); the host checks every
 * request against what the user granted, so an extension can never reach
 * past them. They are shown to the user on install with their risk.
 *
 * `network:<host>` is the only parametrized one: an exact host name (no
 * wildcards), so the user sees exactly where data can go.
 */
export const PERMISSIONS = {
  /** Read the open map: levels, entities, settings, its own data. */
  "map:read": { risk: "low" },
  /** Change the open map (always through undoable commands). */
  "map:write": { risk: "medium" },
  /** Read and drive the editor: selection, active tool/level, camera, view toggles, cursor. */
  editor: { risk: "low" },
  /** Add tools, entity properties and extension points of the core tools. */
  tools: { risk: "low" },
  /** Add procedural generators (map, area, selection, new map). */
  generators: { risk: "low" },
  /** Change how the map is drawn: styles, filters, overlays, own entities, particles, grids. */
  render: { risk: "low" },
  /** Run custom GLSL shaders on the GPU (watched, and turned off if too slow). */
  "render:shaders": { risk: "medium" },
  /** Menus, shortcuts, panels, dialogs, notifications, status bar, palette, tours. */
  ui: { risk: "low" },
  /** Panels with the extension's own HTML in an isolated frame. */
  "ui:iframe": { risk: "medium" },
  /** Read installed packs and their assets. */
  "library:read": { risk: "low" },
  /** Create and edit the user's editable packs (never third-party ones). */
  "packs:write": { risk: "medium" },
  /** Import/export formats, file types, dropped files and the file pickers. */
  files: { risk: "medium" },
  /** Read and write inside one folder the user picks (revocable). */
  folder: { risk: "high" },
  /** Read and write the system clipboard. */
  clipboard: { risk: "medium" },
  /** Open a link in the browser (the user confirms each one). */
  openUrl: { risk: "low" },
  /** Download Google Fonts and register bundled fonts. */
  fonts: { risk: "low" },
  /** Offer services to other extensions and use theirs. */
  services: { risk: "low" },
  /** Read some app preferences (language, units, grid color). */
  "preferences:read": { risk: "low" },
  /** Open extra read-only views of the map (a players' screen). */
  views: { risk: "low" },
} as const

export type StaticPermission = keyof typeof PERMISSIONS
export type NetworkPermission = `network:${string}`
export type Permission = StaticPermission | NetworkPermission
export type PermissionRisk = "low" | "medium" | "high"

/** Exact lowercase DNS name: no scheme, port, path, IP or wildcard. */
const HOST_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/
const IPV4_RE = /^\d+(\.\d+){3}$/

export function isNetworkHost(host: string): boolean {
  return HOST_RE.test(host) && !IPV4_RE.test(host) && !/\.(local|localhost|internal)$/.test(host)
}

export function isPermission(value: unknown): value is Permission {
  if (typeof value !== "string") return false
  if (value in PERMISSIONS) return true
  return value.startsWith("network:") && isNetworkHost(value.slice("network:".length))
}

export function permissionRisk(p: Permission): PermissionRisk {
  if (p.startsWith("network:")) return "high"
  return PERMISSIONS[p as StaticPermission].risk
}

/** The host a `network:` permission allows, or null for the others. */
export function networkHostOf(p: Permission): string | null {
  return p.startsWith("network:") ? p.slice("network:".length) : null
}

/** Whether `granted` lets an extension reach `url` (exact host, https only). */
export function allowsUrl(granted: readonly Permission[], url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "wss:") return false
  if (parsed.username || parsed.password || parsed.port) return false
  return granted.includes(`network:${parsed.hostname}`)
}
