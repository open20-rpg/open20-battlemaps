import {
  type Contribution,
  type DataDrivenStyle,
  type EntityStyle,
  type Primitive,
} from "@open20/battlemaps-sdk"
import { useExtensionsStore, type LiveContribution } from "../../stores/extensionsStore"
import { useViewStore } from "../../stores/viewStore"
import { useMapStore } from "../../stores/mapStore"
import { type MapEntity } from "../map/model/types"
import { type ExtensionRenderBridge } from "../map/render/extensionRender"
import { kindOwner, toSdkEntity } from "./ops"
import { matches } from "./match"
import { runtimeImageUrl, onRuntimeImage } from "./host"
import { type HostServices } from "./services"

type Of<T extends Contribution["type"]> = LiveContribution<Extract<Contribution, { type: T }>>

const MAX_PRIMITIVES = 20_000

/** A data-driven style read for one entity (`{ data: "color" }` → its data.color). */
export function resolveStyle(
  style: DataDrivenStyle,
  entity: MapEntity,
  extId: string,
): EntityStyle {
  const data = entity.ext?.[extId] ?? {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(style)) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof (v as { data?: unknown }).data === "string"
    ) {
      const ref = v as { data: string; default?: unknown }
      const value = data[ref.data] ?? ref.default
      if (value !== undefined) out[k] = value
    } else out[k] = v
  }
  return out as EntityStyle
}

/** A shader id as a style or post shader names it, made global (`<extension>/<id>`). */
export const globalShaderId = (extId: string, id: string): string =>
  id.includes("/") ? id : `${extId}/${id}`

/**
 * The renderer's view of extensions (ExtensionRenderBridge): it reads the
 * contributions in the store and calls the extensions' render callbacks,
 * caching results per entity (entities are immutable, so a new object is a
 * change) and telling the scene when a result arrives.
 */
export function createRenderBridge(services: HostServices): ExtensionRenderBridge {
  const listeners = new Set<() => void>()
  let version = 0
  const bump = () => {
    version++
    for (const l of listeners) l()
  }
  const prims = new WeakMap<MapEntity, Primitive[]>()
  const overrides = new WeakMap<MapEntity, Primitive[] | null>()
  const fnStyles = new WeakMap<MapEntity, Map<string, EntityStyle | null>>()
  const inflight = new WeakSet<object>()
  const bundled = new Map<string, string | null>()
  const grids = new Map<string, Primitive[]>()
  const gridTokens = new Map<string, object>()
  onRuntimeImage(() => bump())

  // A contribution change (or an extension stopping) invalidates the caches.
  let lastRev = -1
  const checkRev = () => {
    const rev = useExtensionsStore.getState().rev
    if (rev !== lastRev) {
      lastRev = rev
      return true
    }
    return false
  }
  const contributions = <T extends Contribution["type"]>(type: T): Of<T>[] =>
    useExtensionsStore
      .getState()
      .contributions.filter((c) => c.contribution.type === type) as Of<T>[]

  const sdk = (e: MapEntity, extId: string) => {
    const map = useMapStore.getState().map
    return toSdkEntity(e, extId, map?.levels[0].id ?? e.level ?? "")
  }

  const ask = <T>(
    key: object,
    run: () => Promise<T>,
    store: (value: T) => void,
    fail: () => void,
  ) => {
    if (inflight.has(key)) return
    inflight.add(key)
    run().then(
      (v) => {
        inflight.delete(key)
        store(v)
        bump()
      },
      () => {
        inflight.delete(key)
        fail()
        bump()
      },
    )
  }

  const cleanPrims = (v: unknown): Primitive[] =>
    Array.isArray(v) ? (v.slice(0, MAX_PRIMITIVES) as Primitive[]) : []

  return {
    rev: () => {
      if (checkRev()) version++
      return version + useExtensionsStore.getState().rev * 1_000_000
    },
    primitivesFor: (entity) => {
      const hit = prims.get(entity)
      if (hit) return hit
      const owner = kindOwner(entity.toolId)
      const type = entity.toolId.slice(entity.toolId.indexOf("/") + 1)
      const c = contributions("entityType").find(
        (x) => x.extId === owner && x.contribution.id === type,
      )
      if (!c) return []
      ask(
        entity,
        () => Promise.resolve(c.contribution.render(sdk(entity, c.extId))),
        (v) => prims.set(entity, cleanPrims(v)),
        () => prims.set(entity, []),
      )
      return undefined
    },
    overrideFor: (entity) => {
      if (overrides.has(entity)) return overrides.get(entity)
      const ref = String(entity.params.extStyle)
      const slash = ref.indexOf("/")
      const extId = ref.slice(0, slash)
      const id = ref.slice(slash + 1)
      const type = entity.toolId === "wall" ? "wallStyle" : "pathStyle"
      const c = contributions(type).find((x) => x.extId === extId && x.contribution.id === id)
      if (!c) return null
      ask(
        entity,
        () => Promise.resolve(c.contribution.render(sdk(entity, extId))),
        (v) => overrides.set(entity, cleanPrims(v)),
        () => overrides.set(entity, null),
      )
      return undefined
    },
    styleFor: (entity) => {
      let style: EntityStyle | null = null
      const merge = (s: EntityStyle | null | undefined) => {
        if (!s) return
        style = {
          ...(style ?? {}),
          ...s,
          filters: [...(style?.filters ?? []), ...(s.filters ?? [])],
        }
      }
      const rules = contributions("styleRule")
        .filter((r) => matches(entity, r.contribution.match, r.extId))
        .sort((a, b) => (a.contribution.priority ?? 0) - (b.contribution.priority ?? 0))
      for (const r of rules) {
        const s = resolveStyle(r.contribution.style, entity, r.extId)
        if (s.shader) s.shader = { ...s.shader, id: globalShaderId(r.extId, s.shader.id) }
        merge(s)
      }
      for (const f of contributions("styleFunction")) {
        if (!matches(entity, f.contribution.match, f.extId)) continue
        let cache = fnStyles.get(entity)
        if (!cache) fnStyles.set(entity, (cache = new Map()))
        if (cache.has(f.key)) {
          const s = cache.get(f.key)
          if (s?.shader) s.shader = { ...s.shader, id: globalShaderId(f.extId, s.shader.id) }
          merge(s)
          continue
        }
        const holder = cache
        const token = { entity, key: f.key }
        ask(
          token,
          () => Promise.resolve(f.contribution.style(sdk(entity, f.extId))),
          (v) => holder.set(f.key, v && typeof v === "object" ? (v as EntityStyle) : null),
          () => holder.set(f.key, null),
        )
      }
      return style
    },
    overlays: (level) => {
      const s = useExtensionsStore.getState()
      const out: Primitive[] = [...s.draft]
      for (const [key, o] of Object.entries(s.overlays)) {
        if (key.includes("::fog:")) continue
        if (o.level && o.level !== level) continue
        out.push(...o.primitives)
      }
      return out.slice(0, MAX_PRIMITIVES)
    },
    postShaders: () =>
      contributions("postShader")
        .sort((a, b) => (a.contribution.order ?? 0) - (b.contribution.order ?? 0))
        .map((p) => ({
          id: globalShaderId(p.extId, p.contribution.shader),
          uniforms: p.contribution.uniforms,
        })),
    shader: (id) => {
      const slash = id.indexOf("/")
      const extId = id.slice(0, slash)
      const local = id.slice(slash + 1)
      const c = contributions("shader").find(
        (x) => x.extId === extId && x.contribution.id === local,
      )
      return c
        ? {
            fragment: c.contribution.fragment,
            uniforms: c.contribution.uniforms,
            animated: c.contribution.animated,
          }
        : null
    },
    imageUrl: (assetId) => {
      const runtime = runtimeImageUrl(assetId)
      if (runtime) return runtime
      // A bundled image: `ext:<id>/<file>` under the extension's assets folder.
      if (bundled.has(assetId)) return bundled.get(assetId) ?? null
      const rest = assetId.slice(4)
      const slash = rest.indexOf("/")
      const extId = rest.slice(0, slash)
      const file = rest.slice(slash + 1)
      const folder = useExtensionsStore.getState().installed[extId]?.manifest.contributes?.assets
      if (!folder || file.split("/").includes("..")) return null
      bundled.set(assetId, null)
      services
        .readFile(extId, `${folder.replace(/\/$/, "")}/${file}`)
        .then((bytes) => {
          const type = file.endsWith(".webp")
            ? "image/webp"
            : file.endsWith(".jpg")
              ? "image/jpeg"
              : "image/png"
          bundled.set(assetId, URL.createObjectURL(new Blob([bytes as BlobPart], { type })))
          bump()
        })
        .catch(() => {})
      return null
    },
    gridPrimitives: (kind, width, height) => {
      const key = `${kind}:${width}x${height}:${useExtensionsStore.getState().rev}`
      const hit = grids.get(key)
      if (hit) return hit
      const owner = kindOwner(kind)
      const id = kind.slice(kind.indexOf("/") + 1)
      const c = contributions("gridType").find((x) => x.extId === owner && x.contribution.id === id)
      if (!c) return []
      const token = gridTokens.get(key) ?? {}
      gridTokens.set(key, token)
      ask(
        token,
        () => Promise.resolve(c.contribution.draw({ x: 0, y: 0, w: width, h: height })),
        (v) => grids.set(key, cleanPrims(v)),
        () => grids.set(key, []),
      )
      return undefined
    },
    particles: (level) => {
      const s = useExtensionsStore.getState()
      const out = Object.values(s.particles).flat()
      for (const c of contributions("particles")) {
        if (c.contribution.toggle && s.viewToggles[c.key] === false) continue
        out.push(...c.contribution.emitters)
      }
      return out.filter((e) => !e.level || e.level === level).slice(0, 32)
    },
    animating: () => {
      if (!useViewStore.getState().animations) return false
      const s = useExtensionsStore.getState()
      if (Object.keys(s.particles).length || contributions("particles").length) return true
      const used = new Set([
        ...contributions("postShader").map((p) => globalShaderId(p.extId, p.contribution.shader)),
      ])
      return contributions("shader").some(
        (c) =>
          c.contribution.animated &&
          (used.has(`${c.extId}/${c.contribution.id}`) || c.contribution.target === "entity"),
      )
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}
