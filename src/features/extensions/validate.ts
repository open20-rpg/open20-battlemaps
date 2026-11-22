import { CONTRIBUTION_PERMISSIONS, type Contribution } from "@open20/battlemaps-sdk"

/**
 * Checks on a contribution before the app takes it: the shape the UI and
 * the renderer rely on, and bounds on what an extension can hand over (a
 * shader's size, how many params…). Returns the problem, or null.
 */

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const MAX_SHADER = 20_000
const MAX_ICON = 8_000

const isFn = (v: unknown) => typeof v === "function"
const isText = (v: unknown) =>
  (typeof v === "string" && v.length > 0 && v.length <= 200) ||
  (typeof v === "object" && v !== null && typeof (v as { es?: unknown }).es === "string")

/** Fields that must be callbacks, per type. */
const REQUIRED_CALLBACKS: Partial<Record<Contribution["type"], string[]>> = {
  selectionMode: ["select"],
  scatterDistribution: ["points"],
  wallStyle: ["render"],
  pathStyle: ["render"],
  terrainRule: ["weights"],
  entityType: ["render"],
  generator: ["generate"],
  styleFunction: ["style"],
  gridType: ["draw", "snap"],
  snapProvider: ["points"],
  viewToggle: ["onChange"],
  importFormat: ["import"],
  exportFormat: ["export"],
  exportHook: ["process"],
  dungeondraftTranslator: ["translate"],
  command: ["run"],
  contextMenu: ["run"],
  panel: ["render"],
  libraryTab: ["search"],
  stats: ["compute"],
  assetBehavior: ["onPlaced"],
  placementRule: ["adjust"],
}

/** Types whose name is shown in the UI. */
const NAMED = new Set<Contribution["type"]>([
  "tool",
  "selectionMode",
  "brushTip",
  "scatterDistribution",
  "wallStyle",
  "pathStyle",
  "terrainRule",
  "waterStyle",
  "entityType",
  "generator",
  "shader",
  "fillShader",
  "layer",
  "lightType",
  "particles",
  "gridType",
  "snapProvider",
  "viewToggle",
  "importFormat",
  "exportFormat",
  "exportProfile",
  "placementRule",
  "newMapPreset",
])

export function validateContribution(c: Contribution): string | null {
  if (!c || typeof c !== "object" || !(c.type in CONTRIBUTION_PERMISSIONS))
    return "unknown contribution type"
  const rec = c as unknown as Record<string, unknown>
  if (c.type !== "properties" && !(typeof rec.id === "string" && ID_RE.test(rec.id)))
    return `${c.type} needs an id of letters, digits and ._- (≤64)`
  if (NAMED.has(c.type) && !isText(rec.name)) return `${c.type} needs a name`
  for (const key of REQUIRED_CALLBACKS[c.type] ?? [])
    if (!isFn(rec[key])) return `${c.type}.${key} must be a function`
  switch (c.type) {
    case "tool":
      if (typeof c.icon !== "string" || c.icon.length > MAX_ICON) return "tool icon is too big"
      if ((c.params ?? []).length > 40) return "too many params"
      return null
    case "shader":
      if (typeof c.fragment !== "string" || c.fragment.length > MAX_SHADER)
        return `shader source must be ≤ ${MAX_SHADER} chars`
      if (!["entity", "layer", "post", "fill"].includes(c.target)) return "unknown shader target"
      return null
    case "layer":
      if (!Number.isFinite(c.value) || c.value <= -1000 || c.value >= 1000)
        return "layer value must be between -1000 and 1000"
      return null
    case "command":
    case "contextMenu":
    case "panel":
    case "iframePanel":
    case "tour":
    case "libraryTab":
    case "stats":
      return isText(c.title) ? null : `${c.type} needs a title`
    case "particles":
      return c.emitters.length <= 16 ? null : "at most 16 emitters"
    case "properties":
      return Array.isArray(c.kinds) && Array.isArray(c.properties) ? null : "kinds and properties"
    case "service":
      return Object.values(c.methods ?? {}).every(isFn) ? null : "service methods must be functions"
    default:
      return null
  }
}
