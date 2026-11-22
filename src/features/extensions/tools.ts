import {
  localize,
  type LocalizedText,
  type ParamSpec,
  type PointerEvent as SdkPointerEvent,
  type PropertiesContribution,
  type ShapeResult,
  type ToolContribution,
  type ToolContext,
} from "@open20/battlemaps-sdk"
import i18n from "../../i18n"
import { useEditorStore } from "../../stores/editorStore"
import { useExtensionsStore, type LiveContribution } from "../../stores/extensionsStore"
import { useToolsStore } from "../../stores/toolsStore"
import { hashSeed } from "@open20/battlemaps-sdk/random"
import { appendSample, ellipsePolygon, rectPolygon } from "../map/model/geometry"
import { type MapEntity, type Vec2 } from "../map/model/types"
import { setExtraBehaviors } from "../tools/behaviors"
import { polylineController } from "../tools/behaviors/shared"
import { type PointerInfo, type ToolBehavior, type ToolCtx } from "../tools/behaviors/types"
import { type ExtraTool, type ToolLeaf } from "../tools/definitions"
import { setExtraProperties, type EntityProperty } from "../tools/properties"
import { type ToolParamSpec } from "../tools/params"
import { extensionIcon } from "./icons"

/**
 * Extensions' tools in the palette: their data becomes a ToolLeaf (params
 * as the app's own param specs, labels as i18n keys) and their handlers a
 * ToolBehavior that forwards to the extension. Same panels, same gestures
 * as the core tools — nothing ad hoc in the UI.
 */

/** An i18n key for an extension's text (registered in every language it has). */
export function textKey(extId: string, text: LocalizedText): string {
  const raw = typeof text === "string" ? text : JSON.stringify(text)
  const key = `x${hashSeed(`${extId}\u0000${raw}`).toString(36)}`
  const ns = "extensionTexts"
  for (const lang of ["es", "en"]) {
    if (!i18n.exists(`${ns}.${key}`, { lng: lang }))
      i18n.addResource(lang, "translation", `${ns}.${key}`, localize(text, lang))
  }
  return `${ns}.${key}`
}

/** An extension's param as the app's own spec (same controls as the core tools). */
export function toParamSpec(extId: string, p: ParamSpec): ToolParamSpec | null {
  const paramKey = String(p.key)
  if (!/^[A-Za-z][\w-]{0,40}$/.test(paramKey)) return null
  switch (p.kind) {
    case "switch":
      return {
        kind: "switch",
        paramKey,
        default: !!p.default,
        labelKey: textKey(extId, p.label),
        ...(p.tooltip ? { tooltipKey: textKey(extId, p.tooltip) } : {}),
      }
    case "slider":
      return {
        kind: "slider",
        paramKey,
        default: p.default,
        labelKey: textKey(extId, p.label),
        min: p.min,
        max: p.max,
        step: p.step,
      }
    case "range":
      return {
        kind: "range",
        paramKey,
        default: p.default,
        labelKey: textKey(extId, p.label),
        min: p.min,
        max: p.max,
        step: p.step,
      }
    case "segmented":
      return {
        kind: "segmented",
        paramKey,
        default: p.default,
        labelKey: textKey(extId, p.label),
        options: p.options.slice(0, 12).map((o) => ({
          value: o.value,
          labelKey: textKey(extId, o.label),
          ...(o.icon ? { icon: extensionIcon(o.icon) } : {}),
        })),
      }
    case "color":
      return {
        kind: "customColor",
        paramKey,
        default: p.default,
        labelKey: textKey(extId, p.label),
        presets: p.presets,
      }
    case "text":
      return {
        kind: "text",
        paramKey,
        default: p.default,
        labelKey: textKey(extId, p.label),
        maxLength: p.maxLength,
      }
    case "number":
      return {
        kind: "number",
        paramKey,
        default: p.default,
        labelKey: textKey(extId, p.label),
        min: p.min,
        max: p.max,
      }
    case "layer":
      return {
        kind: "layer",
        paramKey,
        default: p.default,
        allowed: p.allowed ?? [-400, -100, 100, 200, 300, 400, 700, 900],
      }
    case "asset":
      return {
        kind: "assetPicker",
        paramKey,
        labelKey: textKey(extId, p.label),
        category: p.category,
        select: "single",
        allowNull: true,
        recolor: "none",
        default: { assets: p.default ? [p.default] : [], color: "#ffffff" },
      }
    case "font":
      return {
        kind: "font",
        paramKey,
        labelKey: textKey(extId, p.label),
        default: { family: p.default.family, weight: 400, italic: /italic/i.test(p.default.style) },
      }
    case "button":
      return {
        kind: "button",
        paramKey,
        default: null,
        labelKey: textKey(extId, p.label),
        icon: extensionIcon(p.icon ?? "LuWand"),
      }
  }
  return null
}

/** Param values as the extension sees them (asset pickers as plain ids). */
function sdkParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    const sel = v as { assets?: unknown }
    out[k] =
      v && typeof v === "object" && Array.isArray(sel.assets)
        ? ((sel.assets[0] as string) ?? null)
        : v
  }
  return out
}

const toolCtx = (ctx: ToolCtx): ToolContext => ({
  toolId: ctx.toolId,
  params: sdkParams(ctx.params),
  level: ctx.level,
  snap: ctx.snapEnabled,
})

function pointer(ctx: ToolCtx, e: PointerInfo): SdkPointerEvent {
  return {
    x: e.x,
    y: e.y,
    snapped: ctx.snap({ x: e.x, y: e.y }),
    button: e.button,
    buttons: e.buttons,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    pressure: e.pressure ?? 0.5,
    tiltX: e.tiltX ?? 0,
    tiltY: e.tiltY ?? 0,
    pointerType: e.pointerType === "pen" || e.pointerType === "touch" ? e.pointerType : "mouse",
    touches: 1,
  }
}

/** Run a handler of the extension, logging (not throwing) what goes wrong. */
function run(extId: string, label: string, call: () => unknown): void {
  Promise.resolve()
    .then(call)
    .catch((e: unknown) =>
      useExtensionsStore.getState().log({ extId, kind: "fault", text: `${label}: ${String(e)}` }),
    )
}

/** The behavior of an extension's tool: its gesture (host-side) plus forwarded handlers. */
export function extensionToolBehavior(extId: string, c: ToolContribution): ToolBehavior {
  const setDraft = useEditorStore.getState().setDraft
  const shape = (ctx: ToolCtx, result: ShapeResult) => {
    setDraft([])
    if (c.onShape) run(extId, "onShape", () => c.onShape!(toolCtx(ctx), result))
  }
  // Pointer moves are coalesced: one in flight, the latest one waiting.
  let busy = false
  let queued: { ctx: ToolCtx; e: PointerInfo } | null = null
  const move = (ctx: ToolCtx, e: PointerInfo) => {
    if (!c.onPointerMove || (!c.hover && !e.buttons)) return
    if (busy) {
      queued = { ctx, e }
      return
    }
    busy = true
    Promise.resolve(c.onPointerMove(toolCtx(ctx), pointer(ctx, e)))
      .catch(() => {})
      .finally(() => {
        busy = false
        const next = queued
        queued = null
        if (next) move(next.ctx, next.e)
      })
  }
  const base: ToolBehavior = {
    onPointerDown: (ctx, e) =>
      c.onPointerDown &&
      run(extId, "onPointerDown", () => c.onPointerDown!(toolCtx(ctx), pointer(ctx, e))),
    onPointerMove: move,
    onPointerUp: (ctx, e) =>
      c.onPointerUp &&
      run(extId, "onPointerUp", () => c.onPointerUp!(toolCtx(ctx), pointer(ctx, e))),
    onDoubleClick: (ctx, e) =>
      c.onDoubleClick &&
      run(extId, "onDoubleClick", () => c.onDoubleClick!(toolCtx(ctx), pointer(ctx, e))),
    onKeyDown: (ctx, e) => {
      if (!c.onKey || !(c.keys ?? []).includes(e.key)) return false
      const key = {
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey || e.metaKey,
      }
      run(extId, "onKey", () => c.onKey!(toolCtx(ctx), key))
      return true
    },
    onAction: (ctx, action) =>
      c.onAction && run(extId, "onAction", () => c.onAction!(toolCtx(ctx), action)),
    onActivate: (ctx) =>
      c.onActivate && run(extId, "onActivate", () => c.onActivate!(toolCtx(ctx))),
    onDeactivate: (ctx) => {
      setDraft([])
      useExtensionsStore.getState().setDraft([])
      if (c.onDeactivate) run(extId, "onDeactivate", () => c.onDeactivate!(toolCtx(ctx)))
    },
    onParamsChange: (ctx, patch) =>
      c.onParamsChange &&
      run(extId, "onParamsChange", () => c.onParamsChange!(toolCtx(ctx), sdkParams(patch))),
    cursor: () => useExtensionsStore.getState().cursor ?? c.cursor ?? "crosshair",
  }
  switch (c.gesture ?? "none") {
    case "click":
      return {
        ...base,
        onPointerUp: (ctx, e) => {
          base.onPointerUp?.(ctx, e)
          if (e.button === 0)
            shape(ctx, { gesture: "click", points: [ctx.snap({ x: e.x, y: e.y })] })
        },
      }
    case "drag": {
      let start: Vec2 | null = null
      return {
        ...base,
        onPointerDown: (ctx, e) => {
          base.onPointerDown?.(ctx, e)
          if (e.button === 0) start = ctx.snap({ x: e.x, y: e.y })
        },
        onPointerMove: (ctx, e) => {
          move(ctx, e)
          if (start) setDraft([{ kind: "polyline", points: [start, ctx.snap({ x: e.x, y: e.y })] }])
        },
        onPointerUp: (ctx, e) => {
          base.onPointerUp?.(ctx, e)
          if (start) shape(ctx, { gesture: "drag", points: [start, ctx.snap({ x: e.x, y: e.y })] })
          start = null
        },
      }
    }
    case "rect":
    case "ellipse": {
      let start: Vec2 | null = null
      const polygon = (a: Vec2, b: Vec2) =>
        c.gesture === "rect" ? rectPolygon(a, b) : ellipsePolygon(a, b)
      return {
        ...base,
        onPointerDown: (ctx, e) => {
          if (e.button === 0) start = ctx.snap({ x: e.x, y: e.y })
        },
        onPointerMove: (ctx, e) => {
          move(ctx, e)
          if (start)
            setDraft([{ kind: "polygon", points: polygon(start, ctx.snap({ x: e.x, y: e.y })) }])
        },
        onPointerUp: (ctx, e) => {
          if (!start) return
          const end = ctx.snap({ x: e.x, y: e.y })
          const rect = {
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            w: Math.abs(end.x - start.x),
            h: Math.abs(end.y - start.y),
          }
          if (rect.w > 0 && rect.h > 0)
            shape(ctx, { gesture: c.gesture!, points: polygon(start, end), rect })
          else setDraft([])
          start = null
        },
        onDeactivate: (ctx) => {
          start = null
          base.onDeactivate?.(ctx)
        },
      }
    }
    case "polyline":
    case "polygon": {
      const closed = c.gesture === "polygon"
      const poly = polylineController({
        minPoints: closed ? 3 : 2,
        closed,
        commit: (ctx, points) => shape(ctx, { gesture: c.gesture!, points }),
      })
      return {
        ...base,
        ...poly,
        onDeactivate: (ctx) => (poly.onDeactivate(ctx), base.onDeactivate?.(ctx)),
      }
    }
    case "brush": {
      let points: Vec2[] | null = null
      const radius = (ctx: ToolCtx) => (typeof ctx.params.size === "number" ? ctx.params.size : 0.5)
      return {
        ...base,
        onPointerDown: (_ctx, e) => {
          if (e.button === 0) points = [{ x: e.x, y: e.y }]
        },
        onPointerMove: (ctx, e) => {
          move(ctx, e)
          const p = { x: e.x, y: e.y }
          if (points) points = appendSample(points, p, 0.1)
          setDraft([
            { kind: "circle", center: p, radius: radius(ctx) },
            ...(points ? [{ kind: "polyline" as const, points }] : []),
          ])
        },
        onPointerUp: (ctx) => {
          if (points) shape(ctx, { gesture: "brush", points, radius: radius(ctx) })
          points = null
        },
      }
    }
    default:
      return base
  }
}

/** A tool's leaf in the palette (its id is global: `ext:<extension>/<id>`). */
export function extensionToolLeaf(extId: string, c: ToolContribution): ToolLeaf {
  return {
    type: "tool",
    id: `ext:${extId}/${c.id}`,
    nameKey: textKey(extId, c.name),
    icon: extensionIcon(c.icon),
    ...(c.library ? { library: c.library, librarySelect: c.librarySelect ?? "single" } : {}),
    params: (c.params ?? []).flatMap((p) => toParamSpec(extId, p) ?? []),
  }
}

/** An extension's property as an entity property of the Select panel. */
function extensionProperty(
  extId: string,
  p: PropertiesContribution["properties"][number],
): EntityProperty | null {
  const spec = toParamSpec(extId, p.spec)
  if (!spec) return null
  const t = p.target
  // Distinct keys per extension, so two extensions' "color" don't collide.
  const keyed = { ...spec, paramKey: `${extId}:${spec.paramKey}` } as ToolParamSpec
  if ("data" in t)
    return {
      spec: keyed,
      read: (e) => e.ext?.[extId]?.[t.data] ?? spec.default,
      write: (e, value) => {
        const own = { ...(e.ext?.[extId] ?? {}), [t.data]: value }
        return { ext: { ...(e.ext ?? {}), [extId]: own } }
      },
    }
  if ("param" in t)
    return {
      spec: keyed,
      read: (e) => e.params[t.param] ?? spec.default,
      write: (e, value) => ({ params: { ...e.params, [t.param]: value } }),
    }
  const field = t.field
  return {
    spec: keyed,
    read: (e: MapEntity) =>
      field === "color" || field === "asset"
        ? (e.params[field] ?? spec.default)
        : (e[field] ?? spec.default),
    write: (e: MapEntity, value: unknown) =>
      field === "color" || field === "asset"
        ? { params: { ...e.params, [field]: value } }
        : { [field]: value },
  }
}

/** Keep the palette, behaviors and properties in step with the store's contributions. */
export function syncExtensionTools(contributions: readonly LiveContribution[]): void {
  const extras: ExtraTool[] = []
  const behaviors = new Map<string, ToolBehavior>()
  const props = new Map<string, EntityProperty[]>()
  for (const { extId, contribution: c } of contributions) {
    if (c.type === "tool") {
      const leaf = extensionToolLeaf(extId, c)
      extras.push({ group: c.group, leaf })
      behaviors.set(leaf.id, extensionToolBehavior(extId, c))
    } else if (c.type === "properties") {
      for (const kind of c.kinds)
        for (const p of c.properties) {
          const prop = extensionProperty(extId, p)
          if (prop) props.set(kind, [...(props.get(kind) ?? []), prop])
        }
    } else if (c.type === "wallStyle" || c.type === "pathStyle") {
      // Restyling a wall/path is a property: pick the extension's style or the core one.
      const kind = c.type === "wallStyle" ? "wall" : "path"
      const options = contributions
        .filter((x) => x.contribution.type === c.type)
        .map((x) => ({
          value: `${x.extId}/${(x.contribution as { id: string }).id}`,
          label: (x.contribution as { name: LocalizedText }).name,
        }))
      if (!props.get(kind)?.some((p) => p.spec.paramKey === "extStyle"))
        props.set(kind, [
          ...(props.get(kind) ?? []),
          {
            spec: {
              kind: "segmented",
              paramKey: "extStyle",
              labelKey: "extensions.styleProperty",
              default: "",
              options: [
                { value: "", labelKey: "extensions.coreStyle" },
                ...options.map((o) => ({ value: o.value, labelKey: textKey(extId, o.label) })),
              ],
            },
            read: (e) => (typeof e.params.extStyle === "string" ? e.params.extStyle : ""),
            write: (e, value) => {
              const params = { ...e.params }
              if (value) params.extStyle = value
              else delete params.extStyle
              return { params }
            },
          },
        ])
    }
  }
  setExtraBehaviors(behaviors)
  setExtraProperties(props)
  useToolsStore.getState().setExtraTools(extras)
}
