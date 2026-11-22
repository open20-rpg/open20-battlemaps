/**
 * A host for unit-testing extensions without the app. It keeps an
 * in-memory map, runs the same protocol and permission checks as the app
 * (hostkit.ts) and records everything the extension does, so a test can
 * activate an extension, drive its contributions and assert the result.
 *
 *   const host = createTestHost({ permissions: ["map:read", "map:write"] })
 *   await host.load(myExtension)
 *   await host.contribution("tool", "stamp").onShape(ctx, shape)
 *   expect(host.entities()).toHaveLength(1)
 */
import { type Contribution, type ContributionType } from "./contributions"
import { HostConnection, type MethodHandlers } from "./hostkit"
import { API_VERSION, type Manifest } from "./manifest"
import { type Permission } from "./permissions"
import {
  ExtensionError,
  endpointPair,
  type EventName,
  type HostEvents,
  type HostMethod,
  type ParamsOf,
  type ResultOf,
  type ToExtension,
  type ToHost,
} from "./protocol"
import { runExtension, type ExtensionContext, type ExtensionDefinition } from "./runtime"
import {
  type Entity,
  type EntityQuery,
  type MapChange,
  type MapOp,
  type MapSnapshot,
  type NewEntity,
  type Primitive,
} from "./types"

export interface TestHostOptions {
  permissions?: Permission[]
  manifest?: Partial<Manifest>
  map?: { width: number; height: number } | null
  lang?: string
  settings?: Record<string, unknown>
  messages?: Record<string, string>
  files?: Record<string, Uint8Array | string>
  /** Answers for dialogs, by method (`ui.confirm` → true…), or a function. */
  answers?: Partial<{ [M in HostMethod]: ResultOf<M> | ((p: ParamsOf<M>) => ResultOf<M>) }>
  /** Fake network: url → response. */
  fetch?: (url: string, init: ParamsOf<"net.fetch">) => ResultOf<"net.fetch">
}

interface TestMap {
  width: number
  height: number
  levels: { id: string; name: string; data: Record<string, unknown> }[]
  entities: Entity[]
  ambientLight: string
  buildingWear: string
  postProcess: Record<string, unknown>
  grid: MapSnapshot["grid"]
  data: Record<string, unknown>
}

export interface TestHost {
  /** Activate an extension; resolves once its `activate` finished. */
  load(def: ExtensionDefinition): Promise<ExtensionContext>
  /** Registered contributions of a type (callbacks are callable). */
  contributions<T extends ContributionType>(type: T): Extract<Contribution, { type: T }>[]
  contribution<T extends ContributionType>(type: T, id: string): Extract<Contribution, { type: T }>
  entities(): Entity[]
  map(): TestMap | null
  selection(): string[]
  /** Calls the extension made, in order (method + params). */
  calls: { method: HostMethod; params: unknown }[]
  notifications: string[]
  drafts: Primitive[][]
  overlays: Map<string, Primitive[]>
  storage: Map<string, unknown>
  /** Send an event as if the app did. */
  emit<E extends EventName>(event: E, payload: HostEvents[E]): void
  /** Apply ops as the user would (fires reactions and validators). */
  userApply(ops: MapOp[]): Promise<void>
  grant(p: Permission): void
  revoke(p: Permission): void
  stop(): void
}

const clone = <T>(v: T): T => structuredClone(v)

export function createTestHost(options: TestHostOptions = {}): TestHost {
  const granted = new Set<Permission>(options.permissions ?? [])
  const manifest: Manifest = {
    manifestVersion: 1,
    id: "test.extension",
    name: "Test",
    version: "1.0.0",
    author: { name: "test" },
    engines: { battlemaps: `^${API_VERSION}` },
    ...options.manifest,
  }
  let nextId = 1
  const newId = () => `e${nextId++}`
  let map: TestMap | null =
    options.map === null
      ? null
      : {
          width: options.map?.width ?? 20,
          height: options.map?.height ?? 20,
          levels: [{ id: "level-1", name: "", data: {} }],
          entities: [],
          ambientLight: "#ffffff",
          buildingWear: "grime",
          postProcess: {},
          grid: { kind: "square", cellDistance: 5, unit: "ft" },
          data: {},
        }
  let selection: string[] = []
  let activeLevel = map?.levels[0].id ?? null
  let activeTool: string | null = null
  const contributions = new Map<string, Contribution & { key: string }>()
  const reactions = new Map<string, (c: MapChange) => Promise<unknown>>()
  const validators = new Map<string, (c: MapChange, e: Entity[]) => Promise<unknown>>()
  const history: TestMap[] = []
  const future: TestMap[] = []
  let settings = { ...options.settings }
  const files = new Map(
    Object.entries(options.files ?? {}).map(([k, v]) => [
      k,
      typeof v === "string" ? new TextEncoder().encode(v) : v,
    ]),
  )
  let keyN = 1

  const host: TestHost = {
    calls: [],
    notifications: [],
    drafts: [],
    overlays: new Map(),
    storage: new Map(),
    load: async (def) => {
      const run = runExtension(def, extEnd)
      conn.activate({
        manifest,
        granted: [...granted],
        lang: options.lang ?? "es",
        apiVersion: API_VERSION,
        appVersion: "0.0.0-test",
        settings,
        messages: options.messages ?? {},
        storeBuild: false,
      })
      await conn.ready
      return run.context
    },
    contributions: (type) => [...contributions.values()].filter((c) => c.type === type) as never[],
    contribution: (type, id) => {
      const c = [...contributions.values()].find(
        (x) => x.type === type && (x as { id?: string }).id === id,
      )
      if (!c) throw new Error(`no ${type} "${id}" registered`)
      return c as never
    },
    entities: () => clone(map?.entities ?? []),
    map: () => clone(map),
    selection: () => [...selection],
    emit: (event, payload) => conn.emit(event, payload),
    userApply: async (ops) => {
      const change = apply(ops, null)
      await runReactions(change)
    },
    grant: (p) => granted.add(p),
    revoke: (p) => granted.delete(p),
    stop: () => conn.close(),
  }

  const answer = <M extends HostMethod>(
    m: M,
    p: ParamsOf<M>,
    fallback: ResultOf<M>,
  ): ResultOf<M> => {
    const a = options.answers?.[m] as ResultOf<M> | ((p: ParamsOf<M>) => ResultOf<M>) | undefined
    if (a === undefined) return fallback
    return typeof a === "function" ? (a as (p: ParamsOf<M>) => ResultOf<M>)(p) : a
  }

  const requireMap = (): TestMap => {
    if (!map) throw new ExtensionError("no map is open", "notFound")
    return map
  }

  const toEntity = (n: NewEntity, level: string): Entity => ({
    id: newId(),
    kind: n.kind,
    level: n.level ?? level,
    layer: n.layer ?? 100,
    position: n.position,
    rotation: n.rotation ?? 0,
    scale: n.scale ?? 1,
    flipX: n.flipX ?? false,
    flipY: n.flipY ?? false,
    points: n.points,
    closed: n.closed,
    locked: false,
    text: n.text,
    asset: n.asset,
    color: n.color,
    parent: n.parent,
    data: n.data ?? {},
    params: n.params ?? {},
  })

  /** Apply ops to the in-memory map, as one history step. */
  function apply(
    ops: MapOp[],
    source: string | null,
  ): MapChange & { created: string[]; skipped: number } {
    const m = requireMap()
    history.push(clone(m))
    future.length = 0
    const change = {
      added: [] as string[],
      updated: [] as string[],
      removed: [] as string[],
      settings: false,
      history: null,
      source,
      created: [] as string[],
      skipped: 0,
    }
    const byId = (id: string) => m.entities.find((e) => e.id === id)
    const each = (ids: string[], fn: (e: Entity) => void) => {
      for (const id of ids) {
        const e = byId(id)
        if (!e || e.locked) change.skipped++
        else {
          fn(e)
          change.updated.push(id)
        }
      }
    }
    for (const op of ops) {
      switch (op.op) {
        case "add": {
          const made = op.entities.map((n) => toEntity(n, activeLevel ?? m.levels[0].id))
          m.entities = op.under ? [...made, ...m.entities] : [...m.entities, ...made]
          for (const e of made) {
            change.added.push(e.id)
            change.created.push(e.id)
          }
          break
        }
        case "update":
          each([op.id], (e) => {
            const { params, ...rest } = op.patch
            Object.assign(e, rest)
            if (params) e.params = { ...e.params, ...params }
          })
          break
        case "remove": {
          const drop = new Set(op.ids.filter((id) => !byId(id)?.locked))
          m.entities = m.entities.filter((e) => !drop.has(e.id))
          change.removed.push(...drop)
          selection = selection.filter((id) => !drop.has(id))
          break
        }
        case "move":
          each(op.ids, (e) => {
            e.position = { x: e.position.x + op.delta.x, y: e.position.y + op.delta.y }
            e.points = e.points?.map((p) => ({ x: p.x + op.delta.x, y: p.y + op.delta.y }))
          })
          break
        case "transform":
          each(op.ids, (e) => {
            if (op.rotate) e.rotation += op.rotate
            if (op.scale) e.scale *= op.scale
            if (op.flipX) e.flipX = !e.flipX
            if (op.flipY) e.flipY = !e.flipY
          })
          break
        case "replaceAsset":
          each(op.ids ?? m.entities.filter((e) => e.asset === op.from).map((e) => e.id), (e) => {
            if (e.asset === op.from) e.asset = op.to
          })
          break
        case "group": {
          const g = `g${keyN++}`
          each(op.ids, (e) => (e.group = g))
          break
        }
        case "ungroup":
          each(op.ids, (e) => delete e.group)
          break
        case "link": {
          const l = `l${keyN++}`
          each(op.ids, (e) => (e.link = l))
          break
        }
        case "unlink":
          each(op.ids, (e) => delete e.link)
          break
        case "lock":
          for (const id of op.ids) {
            const e = byId(id)
            if (e) {
              e.locked = op.locked
              change.updated.push(id)
            }
          }
          break
        case "reorder": {
          const set = new Set(op.ids)
          const picked = m.entities.filter((e) => set.has(e.id))
          const rest = m.entities.filter((e) => !set.has(e.id))
          m.entities =
            op.mode === "back" || op.mode === "backward"
              ? [...picked, ...rest]
              : [...rest, ...picked]
          change.updated.push(...picked.map((e) => e.id))
          break
        }
        case "attach":
          each(op.ids, (e) => {
            if (op.parent) e.parent = op.parent
            else delete e.parent
          })
          break
        case "setData":
          each([op.id], (e) => (e.data = op.data ? { ...op.data } : {}))
          break
        case "setMapData":
          m.data = op.data ? { ...op.data } : {}
          change.settings = true
          break
        case "setLevelData": {
          const l = m.levels.find((x) => x.id === op.id)
          if (l) l.data = op.data ? { ...op.data } : {}
          change.settings = true
          break
        }
        case "addLevel":
          m.levels.push({ id: op.id ?? `level-${m.levels.length + 1}`, name: op.name, data: {} })
          change.settings = true
          break
        case "renameLevel": {
          const l = m.levels.find((x) => x.id === op.id)
          if (l) l.name = op.name
          change.settings = true
          break
        }
        case "removeLevel":
          if (m.levels.length > 1) m.levels = m.levels.filter((l) => l.id !== op.id)
          change.settings = true
          break
        case "moveLevel": {
          const i = m.levels.findIndex((l) => l.id === op.id)
          const j = i + op.dir
          if (i >= 0 && j >= 0 && j < m.levels.length)
            [m.levels[i], m.levels[j]] = [m.levels[j], m.levels[i]]
          change.settings = true
          break
        }
        case "setAmbientLight":
          m.ambientLight = op.color
          change.settings = true
          break
        case "setBuildingWear":
          m.buildingWear = op.wear
          change.settings = true
          break
        case "setPostProcess":
          m.postProcess = { ...m.postProcess, ...op.values }
          change.settings = true
          break
        case "resize":
          m.width = op.width
          m.height = op.height
          change.settings = true
          break
        case "setGrid":
          m.grid = { ...m.grid, ...op.grid }
          change.settings = true
          break
      }
    }
    conn.emit("map.changed", { ...change })
    return change
  }

  async function runReactions(change: MapChange): Promise<void> {
    for (const v of validators.values()) {
      const ents = (map?.entities ?? []).filter((e) =>
        [...change.added, ...change.updated].includes(e.id),
      )
      const res = (await v(change, clone(ents))) as { veto?: string } | null | undefined
      if (res?.veto) {
        map = history.pop() ?? map
        host.notifications.push(res.veto)
        return
      }
    }
    for (const r of reactions.values()) {
      const ops = (await r(change)) as MapOp[] | undefined
      if (ops?.length) {
        apply(ops, manifest.id)
        // Same step: drop the history entry the reaction made.
        history.pop()
      }
    }
  }

  const query = (q: EntityQuery): Entity[] => {
    const m = map
    if (!m) return []
    const level =
      q.level === "all" ? null : q.level === "active" || !q.level ? activeLevel : q.level
    let out = m.entities.filter((e) => !level || e.level === level)
    if (q.ids) out = out.filter((e) => q.ids!.includes(e.id))
    if (q.kinds) out = out.filter((e) => q.kinds!.includes(e.kind))
    if (q.assets) out = out.filter((e) => e.asset && q.assets!.includes(e.asset))
    if (q.hasData) out = out.filter((e) => q.hasData! in e.data)
    if (q.group) out = out.filter((e) => e.group === q.group)
    if (q.point) {
      const p = q.point
      out = out.filter((e) => Math.hypot(e.position.x - p.x, e.position.y - p.y) <= 0.5 * e.scale)
    }
    if (q.rect) {
      const r = q.rect
      out = out.filter(
        (e) =>
          e.position.x >= r.x &&
          e.position.y >= r.y &&
          e.position.x <= r.x + r.w &&
          e.position.y <= r.y + r.h,
      )
    }
    return clone(out.slice(0, q.limit ?? Infinity))
  }

  const snapshot = (): MapSnapshot | null =>
    map && {
      width: map.width,
      height: map.height,
      levels: clone(map.levels),
      ambientLight: map.ambientLight,
      buildingWear: map.buildingWear,
      postProcess: clone(map.postProcess),
      grid: clone(map.grid),
      layers: [{ value: 100, name: "User Layer 1" }],
      data: clone(map.data),
      extensions: [],
      entityCount: map.entities.length,
    }

  const handlers: MethodHandlers = {
    "map.get": () => snapshot(),
    "map.query": (q) => query(q),
    "map.hitTest": ({ point }) => query({ point }).map((e) => e.id),
    "map.history": () => ({ canUndo: history.length > 0, canRedo: future.length > 0, labels: [] }),
    "map.apply": ({ ops }) => {
      const r = apply(ops, manifest.id)
      return { created: r.created, skipped: r.skipped }
    },
    "map.addReaction": ({ cb }) => {
      const key = `r${keyN++}`
      reactions.set(key, conn.revive(cb) as unknown as (c: MapChange) => Promise<unknown>)
      return key
    },
    "map.addValidator": ({ cb }) => {
      const key = `v${keyN++}`
      validators.set(
        key,
        conn.revive(cb) as unknown as (c: MapChange, e: Entity[]) => Promise<unknown>,
      )
      return key
    },
    "map.undo": () => {
      const prev = history.pop()
      if (prev && map) {
        future.push(clone(map))
        map = prev
      }
    },
    "map.redo": () => {
      const next = future.pop()
      if (next && map) {
        history.push(clone(map))
        map = next
      }
    },
    "editor.get": () => ({
      selection: [...selection],
      activeLevel,
      activeTool,
      zoom: 100,
      pan: { x: 0, y: 0 },
      view: {
        grid: true,
        snap: true,
        lighting: true,
        shadows: true,
        outside: false,
        animations: false,
      },
      pointer: null,
    }),
    "editor.select": ({ ids, mode }) => {
      if (mode === "add") selection = [...new Set([...selection, ...ids])]
      else if (mode === "remove") selection = selection.filter((id) => !ids.includes(id))
      else selection = [...ids]
      conn.emit("editor.selection", [...selection])
    },
    "editor.setLevel": ({ id }) => {
      activeLevel = id
      conn.emit("editor.level", id)
    },
    "editor.setTool": ({ id }) => {
      activeTool = id
      conn.emit("editor.tool", id)
    },
    "editor.setToolParams": () => {},
    "editor.camera": () => {},
    "editor.setView": () => {},
    "editor.setCursor": () => {},
    "editor.copy": ({ ids }) => ids.length,
    "editor.paste": () => [],
    "editor.trackPointer": () => {},
    "tools.setDraft": ({ primitives }) => {
      host.drafts.push(primitives)
    },
    "render.setOverlay": ({ id, primitives }) => {
      host.overlays.set(id, primitives)
    },
    "render.clearOverlay": ({ id }) => {
      host.overlays.delete(id)
    },
    "render.registerImage": ({ name }) => `ext:${manifest.id}/${name}`,
    "render.setParticles": () => {},
    "render.invalidate": () => {},
    "render.toImage": () => ({ name: "map.png", bytes: new Uint8Array(), mime: "image/png" }),
    "ui.notify": (n) => {
      host.notifications.push(n.message)
      return answer("ui.notify", n, null)
    },
    "ui.confirm": (p) => answer("ui.confirm", p, true),
    "ui.prompt": (p) => answer("ui.prompt", p, p.value ?? ""),
    "ui.choose": (p) => answer("ui.choose", p, p.options[0]?.id ?? null),
    "ui.progress": () => ({ id: `t${keyN++}` }),
    "ui.theme": () => ({ mode: "dark", tokens: {} }),
    "storage.get": ({ key }) => clone(host.storage.get(key)),
    "storage.set": ({ key, value }) => {
      host.storage.set(key, clone(value))
    },
    "storage.delete": ({ key }) => {
      host.storage.delete(key)
    },
    "storage.keys": () => [...host.storage.keys()],
    "self.settings": () => ({ ...settings }),
    "self.setSetting": ({ key, value }) => {
      settings = { ...settings, [key]: value }
      conn.emit("settings.changed", { ...settings })
    },
    "self.requestPermission": ({ permission }) => {
      const ok =
        (manifest.optionalPermissions ?? []).includes(permission) &&
        answer("self.requestPermission", { permission }, true)
      if (ok) granted.add(permission)
      return ok
    },
    "self.file": ({ path }) => {
      const f = files.get(path)
      if (!f) throw new ExtensionError(`no file ${path}`, "notFound")
      return f
    },
    "self.t": ({ key }) => options.messages?.[key] ?? key,
    "self.contribute": ({ contribution }) => {
      const key = `c${keyN++}`
      contributions.set(key, { ...(conn.revive(contribution) as Contribution), key })
      return key
    },
    "self.withdraw": ({ id }) => {
      contributions.delete(id)
      reactions.delete(id)
      validators.delete(id)
    },
    "net.fetch": (p) => {
      if (!options.fetch) throw new ExtensionError("no network in the test host", "failed")
      return options.fetch(p.url, p)
    },
  }

  // Every other method answers from `answers` (or undefined), recorded in `calls`.
  const recorded = new Proxy(handlers, {
    get(target, method: string) {
      const real = target[method as HostMethod] as ((p: unknown) => unknown) | undefined
      return (params: unknown) => {
        host.calls.push({ method: method as HostMethod, params })
        if (real) return real(params)
        const a = options.answers?.[method as HostMethod]
        return typeof a === "function" ? (a as (p: unknown) => unknown)(params) : a
      }
    },
  })

  const [hostEnd, extEnd] = endpointPair<ToHost, ToExtension>()
  const conn: HostConnection = new HostConnection({
    extensionId: manifest.id,
    endpoint: hostEnd,
    handlers: recorded,
    granted: () => [...granted],
    callbackTimeoutMs: 5000,
  })
  return host
}
