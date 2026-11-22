import {
  API_VERSION,
  CONTRIBUTION_PERMISSIONS,
  ExtensionError,
  localize,
  type Contribution,
  type Entity,
  type EntityQuery,
  type MapChange,
  type MapOp,
  type MapSnapshot,
  type Permission,
  type Primitive,
  type ViewToggle,
} from "@open20/battlemaps-sdk"
import { HostConnection, type MethodHandlers } from "@open20/battlemaps-sdk/hostkit"
import {
  type ActivateInfo,
  type Endpoint,
  type HostMethod,
  type ToExtension,
  type ToHost,
} from "@open20/battlemaps-sdk/protocol"
import { useEditorStore } from "../../stores/editorStore"
import { useMapStore } from "../../stores/mapStore"
import { getToolParams, useToolsStore } from "../../stores/toolsStore"
import { useViewStore, type ViewToggleKey } from "../../stores/viewStore"
import {
  scopedKey,
  useExtensionsStore,
  type InstalledExtension,
} from "../../stores/extensionsStore"
import { addEntities, amendLastStep, redo, transformDocument, undo } from "../map/commands"
import { entityBounds, hitTest, newId, rectsIntersect } from "../map/model/geometry"
import { DEFAULT_GRID, type MapDocument, type MapEntity } from "../map/model/types"
import { MAP_LAYERS } from "../tools/definitions"
import { applyOps, diffEntities, kindOwner, OpError, toSdkEntity, toSdkLevels } from "./ops"
import { findPath, findRooms, visibility, walkability } from "./analysis"
import { type HostServices, type SocketHandle } from "./services"
import { validateContribution } from "./validate"
import { BASE_TILE_PX, clampZoom } from "../map/render/viewport"

/** How the extension's code runs: a sandboxed worker in the app, in-process in tests. */
export interface ExtensionRuntime {
  endpoint: Endpoint<ToHost, ToExtension>
  terminate(): void
}

/**
 * Things only the UI can do (it owns the canvas and the dialogs); they're
 * registered by the components that can, and missing ones fail politely.
 */
export interface HostHooks {
  viewportSize?: () => { w: number; h: number }
  renderToImage?: (opts: {
    area?: { x: number; y: number; w: number; h: number }
    level?: string
    pxPerTile?: number
    format?: "png" | "jpeg"
  }) => Promise<Uint8Array>
  notify?: (extId: string, message: string, tone: string, action?: string) => Promise<boolean>
  theme?: () => { mode: "light" | "dark"; tokens: Record<string, string> }
  appVersion?: string
  storeBuild?: boolean
  language?: () => string
}

interface Running {
  id: string
  conn: HostConnection
  runtime: ExtensionRuntime
  reactions: Map<string, (c: MapChange) => Promise<unknown>>
  validators: Map<string, (c: MapChange, e: Entity[]) => Promise<unknown>>
  sockets: Map<string, SocketHandle>
  folder: string | null
  trackPointer: boolean
}

/** What a placement rule may adjust on an entity being placed. */
const PLACEMENT_FIELDS = ["position", "rotation", "scale", "layer", "flipX", "flipY"] as const

/** Limits on what one extension can hold, so a buggy one can't swamp the app. */
export const LIMITS = {
  contributions: 400,
  overlayPrimitives: 20_000,
  opsPerApply: 10_000,
  storageValueBytes: 1_000_000,
  imageBytes: 8 * 1024 * 1024,
  activateTimeoutMs: 15_000,
}

/** Editor view toggles extensions may read and flip (ours plus Animations). */
const VIEW_KEYS: ViewToggleKey[] = ["grid", "snap", "lighting", "shadows", "outside"]

/**
 * The app side of the extension API: one HostConnection per running
 * extension, with handlers that do each method through the app's stores and
 * map commands (never around them). Store changes are turned into events
 * for the extensions that subscribed.
 */
export class ExtensionHost {
  private running = new Map<string, Running>()
  private promptResolvers = new Map<string, (value: unknown) => void>()
  private unsubscribers: (() => void)[] = []
  /** The extension whose ops are being committed right now (map.changed's `source`). */
  private committing: string | null = null
  /** Whether a reaction is amending the last step (its change is part of the user's). */
  private amending = false
  hooks: HostHooks = {}

  constructor(readonly services: HostServices) {}

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  runningIds(): string[] {
    return [...this.running.keys()]
  }

  /** Start an installed extension on `runtime`; resolves once its `activate` is done. */
  async start(ext: InstalledExtension, runtime: ExtensionRuntime): Promise<void> {
    const id = ext.manifest.id
    this.stop(id)
    const store = useExtensionsStore.getState()
    store.setStatus(id, "starting")
    const running: Running = {
      id,
      runtime,
      conn: null as unknown as HostConnection,
      reactions: new Map(),
      validators: new Map(),
      sockets: new Map(),
      folder: null,
      trackPointer: false,
    }
    running.conn = new HostConnection({
      extensionId: id,
      endpoint: runtime.endpoint,
      handlers: this.handlersFor(running),
      granted: () => useExtensionsStore.getState().installed[id]?.granted ?? [],
      onLog: (level, message) =>
        useExtensionsStore
          .getState()
          .log({ extId: id, kind: "log", text: `[${level}] ${message}` }),
      onRequest: (method, allowed) => {
        if (!allowed) useExtensionsStore.getState().log({ extId: id, kind: "denied", text: method })
        else if (!method.startsWith("self.") && !method.startsWith("storage."))
          useExtensionsStore.getState().log({ extId: id, kind: "request", text: method })
      },
      onFault: (reason) =>
        useExtensionsStore.getState().log({ extId: id, kind: "fault", text: reason }),
    })
    this.running.set(id, running)
    this.wireStores()
    const lang = this.hooks.language?.() ?? "es"
    const info: ActivateInfo = {
      manifest: ext.manifest,
      granted: ext.granted,
      lang,
      apiVersion: API_VERSION,
      appVersion: this.hooks.appVersion ?? "0.0.0",
      settings: this.settingsOf(ext),
      messages: await this.messagesFor(ext, lang),
      storeBuild: this.hooks.storeBuild ?? false,
    }
    running.conn.activate(info)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<"timeout">((r) => {
      timer = setTimeout(() => r("timeout"), LIMITS.activateTimeoutMs)
    })
    const result = await Promise.race([running.conn.ready.then(() => "ok" as const), timeout])
    clearTimeout(timer)
    if (result === "timeout") {
      this.stop(id)
      useExtensionsStore.getState().setStatus(id, "error", "activate timed out")
      return
    }
    useExtensionsStore.getState().setStatus(id, "active")
  }

  /** Stop an extension and remove everything it contributed. */
  stop(id: string): void {
    const r = this.running.get(id)
    if (!r) return
    this.running.delete(id)
    r.conn.close()
    r.runtime.terminate()
    for (const s of r.sockets.values()) s.close()
    for (const [pid, resolve] of this.promptResolvers)
      if (useExtensionsStore.getState().prompts.some((p) => p.id === pid && p.extId === id)) {
        resolve(null)
        this.promptResolvers.delete(pid)
      }
    const store = useExtensionsStore.getState()
    store.dropExtension(id)
    store.setStatus(id, "inactive")
    if (this.running.size === 0) this.unwireStores()
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id)
  }

  /** Run the extensions' document hooks; returns their warnings. */
  async documentHooks(kind: "beforeSave" | "afterOpen"): Promise<string[]> {
    const hooks = useExtensionsStore
      .getState()
      .contributions.flatMap((c) =>
        c.contribution.type === "documentHook" && c.contribution[kind]
          ? [c.contribution[kind]]
          : [],
      )
    // A broken hook never blocks saving or opening.
    const answers = await Promise.all(hooks.map((fn) => Promise.resolve(fn()).catch(() => [])))
    return answers.flatMap((warnings) =>
      Array.isArray(warnings)
        ? warnings.filter((w): w is string => typeof w === "string").map((w) => w.slice(0, 300))
        : [],
    )
  }

  /** Call an extension's callback by its connection (used by integrations). */
  connection(id: string): HostConnection | undefined {
    return this.running.get(id)?.conn
  }

  /** Answer a pending prompt (from the ExtensionPrompts UI). */
  answerPrompt(id: string, value: unknown): void {
    const resolve = this.promptResolvers.get(id)
    this.promptResolvers.delete(id)
    useExtensionsStore.getState().dropPrompt(id)
    resolve?.(value)
  }

  /** Broadcast an event to every running extension that subscribed (and may see it). */
  broadcast: HostConnection["emit"] = (event, payload) => {
    for (const r of this.running.values()) r.conn.emit(event, payload)
  }

  // -- settings & translations ------------------------------------------------

  private settingsOf(ext: InstalledExtension): Record<string, unknown> {
    const specs = ext.manifest.contributes?.settings ?? {}
    const out: Record<string, unknown> = {}
    for (const [k, spec] of Object.entries(specs)) out[k] = ext.settings[k] ?? spec.default
    return out
  }

  private async messagesFor(
    ext: InstalledExtension,
    lang: string,
  ): Promise<Record<string, string>> {
    const locales = ext.manifest.contributes?.locales ?? {}
    const path = locales[lang] ?? locales[lang.split("-")[0]] ?? locales.es
    if (!path) return {}
    try {
      const raw = await this.services.readFile(ext.manifest.id, path)
      const json = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
      return Object.fromEntries(
        Object.entries(json).filter((e): e is [string, string] => typeof e[1] === "string"),
      )
    } catch {
      return {}
    }
  }

  // -- store events -----------------------------------------------------------

  private lastHistory = { past: 0, future: 0 }

  private wireStores(): void {
    if (this.unsubscribers.length) return
    const temporal = useMapStore.temporal
    this.lastHistory = {
      past: temporal.getState().pastStates.length,
      future: temporal.getState().futureStates.length,
    }
    this.unsubscribers.push(
      useMapStore.subscribe((s, prev) => this.onMapChange(prev.map, s.map)),
      useEditorStore.subscribe((s, prev) => {
        if (s.selection !== prev.selection) this.broadcast("editor.selection", [...s.selection])
        if (s.activeLevel !== prev.activeLevel) this.broadcast("editor.level", s.activeLevel)
        if (s.pointer !== prev.pointer)
          for (const r of this.running.values())
            if (r.trackPointer) r.conn.emit("editor.pointer", s.pointer)
      }),
      useToolsStore.subscribe((s, prev) => {
        if (s.path !== prev.path) this.broadcast("editor.tool", this.activeToolId())
      }),
      useViewStore.subscribe((s, prev) => {
        if (s.zoom !== prev.zoom || s.panX !== prev.panX || s.panY !== prev.panY)
          this.broadcast("editor.camera", { zoom: s.zoom, pan: { x: s.panX, y: s.panY } })
        for (const k of VIEW_KEYS)
          if (s[k] !== prev[k]) this.broadcast("editor.view", { toggle: k, on: s[k] })
      }),
    )
  }

  private unwireStores(): void {
    for (const u of this.unsubscribers) u()
    this.unsubscribers = []
  }

  private activeToolId(): string | null {
    const path = useToolsStore.getState().path
    const last = path[path.length - 1]
    return last && last.type === "tool" ? last.id : null
  }

  private onMapChange(before: MapDocument | null, after: MapDocument | null): void {
    if (before === after) return
    const temporal = useMapStore.temporal.getState()
    const past = temporal.pastStates.length
    const future = temporal.futureStates.length
    const history =
      past < this.lastHistory.past && future > this.lastHistory.future
        ? "undo"
        : past > this.lastHistory.past && future < this.lastHistory.future
          ? "redo"
          : null
    this.lastHistory = { past, future }
    if (!before && after) return this.broadcast("map.opened", this.snapshot(after, null))
    if (before && !after) return this.broadcast("map.closed", null)
    if (!before || !after) return
    const diff = diffEntities(before, after)
    const change: MapChange = { ...diff, history, source: this.committing }
    this.broadcast("map.changed", change)
    // Reactions and validators answer the user's own edits (not undo, not
    // other extensions' — that would let two extensions ping-pong forever).
    if (!this.committing && !history && !this.amending) void this.react(change, after)
  }

  private async react(change: MapChange, map: MapDocument): Promise<void> {
    const touched = new Set([...change.added, ...change.updated])
    const added = new Set(change.added)
    const level = map.levels[0].id
    const running = [...this.running.values()]
    // Validators first, all asked at once: any veto undoes the change.
    const verdicts = await Promise.all(
      running.flatMap((r) => {
        const entities = map.entities
          .filter((e) => touched.has(e.id))
          .map((e) => toSdkEntity(e, r.id, level))
        // A validator that throws doesn't veto (a bug in it shouldn't block the user).
        return [...r.validators.values()].map((v) =>
          v(change, entities).then(
            (res) => ({ extId: r.id, res: res as { veto?: unknown } | null }),
            () => null,
          ),
        )
      }),
    )
    const veto = verdicts.find((v) => v && typeof v.res?.veto === "string")
    if (veto) {
      if (useMapStore.getState().map === map) {
        undo()
        const t = useMapStore.temporal
        const f = t.getState().futureStates
        t.setState({ futureStates: f.slice(0, -1) })
        this.lastHistory.future = f.length - 1
      }
      await this.hooks.notify?.(veto.extId, String(veto.res?.veto).slice(0, 300), "warning")
      return
    }
    // Then what joins the user's step: placement rules and asset behaviors
    // for what was placed, and reactions. Asked together, applied in order.
    const placed = map.entities.filter((e) => added.has(e.id))
    const asks: Promise<{ extId: string; ops: MapOp[] } | null>[] = []
    for (const r of running) {
      if (placed.length) {
        const rules = useExtensionsStore
          .getState()
          .contributions.filter((c) => c.extId === r.id)
          .map((c) => c.contribution)
        for (const k of rules)
          for (const e of placed) asks.push(this.ruleOps(k, toSdkEntity(e, r.id, level), r.id))
      }
      for (const reaction of r.reactions.values())
        asks.push(
          reaction(change).then(
            (ops) => (Array.isArray(ops) ? { extId: r.id, ops: ops as MapOp[] } : null),
            () => null,
          ),
        )
    }
    let expected = map
    for (const answer of await Promise.all(asks)) {
      if (!answer?.ops.length) continue
      // Only amend if the user hasn't moved on (else it'd join an unrelated step).
      if (useMapStore.getState().map !== expected) return
      this.amending = true
      this.committing = answer.extId
      try {
        amendLastStep((m) =>
          this.withUse(this.opsOn(m, answer.ops, answer.extId).map, answer.extId),
        )
      } catch {
        // Invalid ops from a rule or reaction are dropped.
      } finally {
        this.amending = false
        this.committing = null
      }
      expected = useMapStore.getState().map ?? expected
    }
  }

  /** The ops a placement rule or asset behavior answers for an entity just placed. */
  private async ruleOps(
    k: Contribution,
    sdk: Entity,
    extId: string,
  ): Promise<{ extId: string; ops: MapOp[] } | null> {
    try {
      if (k.type === "placementRule" && k.kinds.includes(sdk.kind)) {
        const adjusted = (await k.adjust({ ...sdk })) as Partial<Entity> | null
        if (!adjusted) return null
        const patch: Record<string, unknown> = {}
        for (const f of PLACEMENT_FIELDS)
          if (adjusted[f] !== undefined && JSON.stringify(adjusted[f]) !== JSON.stringify(sdk[f]))
            patch[f] = adjusted[f]
        return Object.keys(patch).length
          ? { extId, ops: [{ op: "update", id: sdk.id, patch }] }
          : null
      }
      if (k.type === "assetBehavior" && sdk.asset && (k.match.assets ?? []).includes(sdk.asset)) {
        const res = await k.onPlaced(sdk)
        return Array.isArray(res) ? { extId, ops: res } : null
      }
    } catch {
      // A failing rule changes nothing.
    }
    return null
  }

  // -- helpers ------------------------------------------------------------------

  private requireMap(): MapDocument {
    const map = useMapStore.getState().map
    if (!map) throw new ExtensionError("no map is open", "notFound")
    return map
  }

  private activeLevel(map: MapDocument): string {
    return useEditorStore.getState().activeLevel ?? map.levels[0].id
  }

  private opsOn(map: MapDocument, ops: MapOp[], extId: string) {
    if (!Array.isArray(ops)) throw new ExtensionError("ops must be a list", "invalid")
    if (ops.length > LIMITS.opsPerApply) throw new ExtensionError("too many ops at once", "invalid")
    try {
      return applyOps(map, ops, extId, this.activeLevel(map))
    } catch (e) {
      if (e instanceof OpError) throw new ExtensionError(e.message, "invalid")
      throw e
    }
  }

  snapshot(map: MapDocument, extId: string | null): MapSnapshot {
    const own = extId ? (map.ext?.[extId] ?? {}) : {}
    const extLayers = useExtensionsStore
      .getState()
      .contributions.filter((c) => c.contribution.type === "layer")
      .map((c) => {
        const l = c.contribution as Extract<Contribution, { type: "layer" }>
        return { value: l.value, name: localize(l.name, this.hooks.language?.() ?? "es") }
      })
    return {
      width: map.width,
      height: map.height,
      levels: toSdkLevels(map, extId ?? ""),
      ambientLight: map.environment.ambientLight,
      buildingWear: map.buildingWear,
      postProcess: { ...map.postProcess },
      grid: { ...(map.grid ?? DEFAULT_GRID) } as MapSnapshot["grid"],
      layers: [...MAP_LAYERS.map((l) => ({ value: l.value, name: l.nameKey })), ...extLayers].sort(
        (a, b) => a.value - b.value,
      ),
      data: { ...own },
      extensions: [...(map.extensions ?? [])],
      entityCount: map.entities.length,
    }
  }

  private query(map: MapDocument, q: EntityQuery, extId: string): Entity[] {
    const active = this.activeLevel(map)
    const level = q.level === "all" ? null : !q.level || q.level === "active" ? active : q.level
    const sizeOf = () => undefined
    let list: MapEntity[] = map.entities.filter(
      (e) => !level || (e.level ?? map.levels[0].id) === level,
    )
    if (q.ids) {
      const ids = new Set(q.ids)
      list = list.filter((e) => ids.has(e.id))
    }
    if (q.kinds) {
      const kinds = new Set<string>(q.kinds)
      list = list.filter((e) => kinds.has(e.toolId))
    }
    if (q.assets) {
      const assets = new Set(q.assets)
      list = list.filter((e) => typeof e.params.asset === "string" && assets.has(e.params.asset))
    }
    if (q.hasData) list = list.filter((e) => e.ext?.[extId] && q.hasData! in e.ext[extId])
    if (q.group) list = list.filter((e) => e.group === q.group)
    if (q.rect) {
      const r = q.rect
      list = list.filter((e) => rectsIntersect(entityBounds(e, sizeOf), r))
    }
    if (q.point) {
      const p = q.point
      list = list.filter((e) => {
        const b = entityBounds(e, sizeOf)
        return p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h
      })
    }
    const limit = Math.max(0, Math.min(q.limit ?? 100_000, 100_000))
    return list.slice(0, limit).map((e) => toSdkEntity(e, extId, map.levels[0].id))
  }

  private ask<T>(
    prompt: Parameters<ReturnType<typeof useExtensionsStore.getState>["pushPrompt"]>[0],
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      this.promptResolvers.set(prompt.id, resolve as (v: unknown) => void)
      useExtensionsStore.getState().pushPrompt(prompt)
    })
  }

  private grant(extId: string, permission: Permission): void {
    const store = useExtensionsStore.getState()
    const ext = store.installed[extId]
    if (!ext || ext.granted.includes(permission)) return
    store.patchInstalled(extId, { granted: [...ext.granted, permission] })
    void this.persist()
  }

  /** Save the registry (enabled, grants, settings) after a change. */
  async persist(): Promise<void> {
    const installed = useExtensionsStore.getState().installed
    await this.services.saveRegistry(
      Object.values(installed).map((e) => ({
        id: e.manifest.id,
        enabled: e.enabled,
        granted: e.granted,
        settings: e.settings,
      })),
    )
  }

  // -- handlers -----------------------------------------------------------------

  private handlersFor(r: Running): MethodHandlers {
    const extId = r.id
    const store = () => useExtensionsStore.getState()
    const svc = this.services
    const commit = (ops: MapOp[]) => {
      const map = this.requireMap()
      const result = this.opsOn(map, ops, extId)
      if (result.map !== map) {
        this.committing = extId
        try {
          transformDocument(() => this.withUse(result.map, extId))
        } finally {
          this.committing = null
        }
      }
      return { created: result.created, skipped: result.skipped }
    }
    const level = (l?: string) => l ?? this.activeLevel(this.requireMap())
    const entitiesOn = (map: MapDocument, l: string) =>
      map.entities.filter((e) => (e.level ?? map.levels[0].id) === l)

    return {
      "map.get": () => {
        const map = useMapStore.getState().map
        return map ? this.snapshot(map, extId) : null
      },
      "map.query": (q) => this.query(this.requireMap(), q ?? {}, extId),
      "map.hitTest": ({ point, level: l }) => {
        const map = this.requireMap()
        const on = entitiesOn(map, level(l))
        const hit = hitTest(on, point, () => undefined)
        return hit ? [hit.id] : []
      },
      "map.history": () => {
        const t = useMapStore.temporal.getState()
        return { canUndo: t.pastStates.length > 0, canRedo: t.futureStates.length > 0, labels: [] }
      },
      "map.apply": ({ ops }) => commit(ops),
      "map.addReaction": ({ cb }) => {
        const key = scopedKey(extId, `reaction:${newId()}`)
        r.reactions.set(key, r.conn.revive(cb) as unknown as (c: MapChange) => Promise<unknown>)
        return key
      },
      "map.addValidator": ({ cb }) => {
        const key = scopedKey(extId, `validator:${newId()}`)
        r.validators.set(
          key,
          r.conn.revive(cb) as unknown as (c: MapChange, e: Entity[]) => Promise<unknown>,
        )
        return key
      },
      "map.undo": () => undo(),
      "map.redo": () => redo(),
      "analysis.rooms": ({ level: l }) => {
        const map = this.requireMap()
        const lv = level(l)
        return findRooms(entitiesOn(map, lv), lv)
      },
      "analysis.walkability": ({ level: l, resolution }) => {
        const map = this.requireMap()
        return walkability(entitiesOn(map, level(l)), map.width, map.height, resolution)
      },
      "analysis.path": ({ from, to, level: l }) => {
        const map = this.requireMap()
        return findPath(walkability(entitiesOn(map, level(l)), map.width, map.height), from, to)
      },
      "analysis.visibility": ({ from, radius, level: l }) => {
        const map = this.requireMap()
        return visibility(entitiesOn(map, level(l)), from, Math.min(Math.max(radius, 0), 500))
      },
      "render.toImage": async (opts) => {
        if (!this.hooks.renderToImage)
          throw new ExtensionError("rendering isn't available right now", "notFound")
        const format = opts.format ?? "png"
        const bytes = await this.hooks.renderToImage({ ...opts, format })
        return { name: `map.${format}`, bytes, mime: `image/${format}` }
      },
      "editor.get": () => {
        const e = useEditorStore.getState()
        const v = useViewStore.getState()
        return {
          selection: [...e.selection],
          activeLevel: e.activeLevel,
          activeTool: this.activeToolId(),
          zoom: v.zoom,
          pan: { x: v.panX, y: v.panY },
          view: {
            grid: v.grid,
            snap: v.snap,
            lighting: v.lighting,
            shadows: v.shadows,
            outside: v.outside,
            animations: v.animations,
          },
          pointer: e.pointer,
        }
      },
      "editor.select": ({ ids, mode }) => {
        const map = this.requireMap()
        const known = new Set(map.entities.map((e) => e.id))
        const valid = ids.filter((id) => known.has(id))
        const e = useEditorStore.getState()
        if (mode === "add") e.select([...new Set([...e.selection, ...valid])])
        else if (mode === "remove") e.deselect(valid)
        else e.select(valid)
      },
      "editor.setLevel": ({ id }) => {
        const map = this.requireMap()
        if (!map.levels.some((l) => l.id === id))
          throw new ExtensionError(`no level ${id}`, "notFound")
        useEditorStore.getState().setActiveLevel(id)
      },
      "editor.setTool": ({ id, params }) => {
        const tools = useToolsStore.getState()
        tools.selectToolById(id)
        if (this.activeToolId() !== id) throw new ExtensionError(`no tool ${id}`, "notFound")
        if (params) tools.setToolParams(id, params)
      },
      "editor.setToolParams": ({ id, params }) => {
        useToolsStore.getState().setToolParams(id, params)
      },
      "editor.camera": (target) => this.camera(target),
      "editor.setView": ({ toggle, on }) => this.setView(toggle, on),
      "editor.setCursor": ({ cursor }) => {
        store().setCursor(cursor && /^[a-z-]{1,30}$/.test(cursor) ? cursor : null)
      },
      "editor.copy": ({ ids }) => {
        const map = this.requireMap()
        const set = new Set(ids)
        const picked = map.entities.filter((e) => set.has(e.id))
        useEditorStore.getState().setClipboard(picked)
        return picked.length
      },
      "editor.paste": ({ offset, at }) => {
        const map = this.requireMap()
        const clip = useEditorStore.getState().clipboard
        if (!clip.length) return []
        const first = clip[0].position
        const d = at ? { x: at.x - first.x, y: at.y - first.y } : (offset ?? { x: 1, y: 1 })
        const lv = this.activeLevel(map)
        const fresh = clip.map((e) => ({
          ...e,
          id: newId(),
          level: lv,
          position: { x: e.position.x + d.x, y: e.position.y + d.y },
          points: e.points?.map((p) => ({ x: p.x + d.x, y: p.y + d.y })),
          group: undefined,
          link: undefined,
          parent: undefined,
        }))
        this.committing = extId
        try {
          addEntities(fresh)
        } finally {
          this.committing = null
        }
        return fresh.map((e) => e.id)
      },
      "editor.trackPointer": ({ on }) => {
        r.trackPointer = on
      },
      "tools.setDraft": ({ primitives }) => {
        store().setDraft(capPrimitives(primitives))
      },
      "render.setOverlay": ({ id, primitives, level: l }) => {
        store().setOverlay(scopedKey(extId, id), {
          extId,
          primitives: capPrimitives(primitives),
          level: l,
        })
      },
      "render.clearOverlay": ({ id }) => store().setOverlay(scopedKey(extId, id), null),
      "render.registerImage": ({ name, bytes, mime }) => {
        if (!/^[A-Za-z0-9._-]{1,80}$/.test(name))
          throw new ExtensionError("bad image name", "invalid")
        if (!(bytes instanceof Uint8Array) || bytes.length > LIMITS.imageBytes)
          throw new ExtensionError("image too big", "invalid")
        if (!/^image\/(png|webp|jpeg)$/.test(mime))
          throw new ExtensionError("png, webp or jpeg", "invalid")
        const assetId = `ext:${extId}/${name}`
        registerRuntimeImage(assetId, bytes, mime)
        return assetId
      },
      "render.setParticles": ({ id, emitters }) => {
        store().setParticles(scopedKey(extId, id), emitters ? emitters.slice(0, 16) : null)
      },
      "render.invalidate": () => {
        useExtensionsStore.setState((s) => ({ rev: s.rev + 1 }))
      },
      "ui.notify": async (n) => {
        const message = String(n.message).slice(0, 500)
        if (n.actions && n.actions.length > 1) {
          return this.ask<string | null>({
            id: newId("prompt"),
            extId,
            kind: "choose",
            title: message,
            options: n.actions.slice(0, 6),
          })
        }
        const action = n.actions?.[0]
        const clicked =
          (await this.hooks.notify?.(extId, message, n.tone ?? "info", action?.label)) ?? false
        return clicked && action ? action.id : null
      },
      "ui.confirm": ({ title, message, danger }) =>
        this.ask<boolean>({
          id: newId("prompt"),
          extId,
          kind: "confirm",
          title,
          message,
          danger,
        }).then((v) => v === true),
      "ui.prompt": ({ title, label, value }) =>
        this.ask<string | null>({
          id: newId("prompt"),
          extId,
          kind: "prompt",
          title,
          label,
          value: value ?? "",
        }),
      "ui.choose": ({ title, options }) =>
        this.ask<string | null>({
          id: newId("prompt"),
          extId,
          kind: "choose",
          title,
          options: options.slice(0, 50),
        }),
      "ui.updatePanel": ({ id, ui }) => {
        store().setPanel(scopedKey(extId, id), { ui: r.conn.revive(ui) as never })
      },
      "ui.openPanel": ({ id }) => store().setPanel(scopedKey(extId, id), { open: true }),
      "ui.closePanel": ({ id }) => store().setPanel(scopedKey(extId, id), { open: false }),
      "ui.postToFrame": ({ panel, message }) => {
        frameBus.post(scopedKey(extId, panel), message)
      },
      "ui.setStatus": ({ id, text, tooltip }) =>
        store().setStatusItem(
          scopedKey(extId, id),
          text ? { text: text.slice(0, 80), tooltip } : null,
        ),
      "ui.startTour": ({ id }) => {
        const key = scopedKey(extId, `tour:${id}`)
        if (!store().contributions.some((c) => c.key === key))
          throw new ExtensionError(`no tour ${id}`, "notFound")
        store().setTour({ key, step: 0 })
      },
      "ui.progress": ({ title }) => {
        const id = newId("task")
        store().setProgress({ id, extId, title: title.slice(0, 120), value: null })
        return { id }
      },
      "ui.progressUpdate": ({ id, value, message }) => {
        const task = store().progress.find((p) => p.id === id && p.extId === extId)
        if (task) store().setProgress({ ...task, value, message })
      },
      "ui.progressEnd": ({ id }) => {
        if (store().progress.some((p) => p.id === id && p.extId === extId))
          store().setProgress(null, id)
      },
      "ui.theme": () => this.hooks.theme?.() ?? { mode: "dark", tokens: {} },
      "library.packs": () => svc.libraryPacks(),
      "library.search": (q) => svc.librarySearch({ ...q, limit: Math.min(q.limit ?? 100, 500) }),
      "library.asset": ({ id }) => svc.libraryAsset(id),
      "library.image": ({ id, size }) => svc.libraryImage(id, size),
      "packs.create": ({ name, author }) => svc.createPack(name.slice(0, 80), author ?? ""),
      "packs.importImages": ({ pack, files, category }) => svc.importImages(pack, files, category),
      "packs.setTags": ({ asset, tags }) => svc.setAssetTags(asset, tags.slice(0, 50)),
      "packs.setMetadata": ({ asset, data }) => svc.setAssetMetadata(asset, data),
      "files.pick": ({ extensions, multiple }) => svc.pickFiles(extensions, !!multiple),
      "files.save": ({ file }) => svc.saveFile(file),
      "folder.request": async () => {
        r.folder = await svc.pickFolder()
        return r.folder ? folderName(r.folder) : null
      },
      "folder.list": ({ path }) => svc.folderList(this.folderOf(r), safeRelative(path ?? "")),
      "folder.read": ({ path }) => svc.folderRead(this.folderOf(r), safeRelative(path)),
      "folder.write": ({ path, bytes }) =>
        svc.folderWrite(this.folderOf(r), safeRelative(path), bytes),
      "folder.release": () => {
        r.folder = null
      },
      "clipboard.writeText": ({ text }) => svc.clipboardWriteText(String(text)),
      "clipboard.readText": () => svc.clipboardReadText(),
      "clipboard.writeImage": ({ image }) => svc.clipboardWriteImage(image),
      "net.fetch": ({ url, method, headers, body }) =>
        svc.fetch({
          url,
          method: (method ?? "GET").toUpperCase(),
          headers: headers ?? {},
          body: typeof body === "string" ? new TextEncoder().encode(body) : body,
        }),
      "net.socket": ({ url }) => {
        const id = newId("socket")
        const handle = svc.openSocket(
          url,
          (data) => r.conn.emit("net.message", { socket: id, data }),
          () => {
            r.sockets.delete(id)
            r.conn.emit("net.closed", { socket: id })
          },
        )
        r.sockets.set(id, handle)
        return id
      },
      "net.socketSend": ({ id, data }) => {
        const s = r.sockets.get(id)
        if (!s) throw new ExtensionError("socket is closed", "notFound")
        s.send(String(data))
      },
      "net.socketClose": ({ id }) => {
        r.sockets.get(id)?.close()
        r.sockets.delete(id)
      },
      "app.openUrl": async ({ url }) => {
        if (!/^https:\/\/[^\s]+$/.test(url)) throw new ExtensionError("only https links", "invalid")
        const ok = await this.ask<boolean>({ id: newId("prompt"), extId, kind: "openUrl", url })
        if (ok) await svc.openUrl(url)
        return ok === true
      },
      "fonts.load": ({ family }) => svc.loadFont(String(family).slice(0, 100)),
      "services.call": async ({ service, method, args }) =>
        this.callService(extId, service, method, args),
      "services.emit": ({ name, payload }) => {
        for (const other of this.running.values())
          if (other.id !== extId) other.conn.emit("service.event", { from: extId, name, payload })
      },
      "app.preferences": () => ({
        language: this.hooks.language?.() ?? "es",
        units: (this.requireMapOrNull()?.grid ?? DEFAULT_GRID).unit,
        gridColor: "#000000",
      }),
      "views.open": ({ id }) => {
        this.requireOwn(extId, "view", id)
        store().setPanel(scopedKey(extId, `view:${id}`), { open: true })
      },
      "views.close": ({ id }) => store().setPanel(scopedKey(extId, `view:${id}`), { open: false }),
      "views.reveal": ({ id, polygon }) => {
        const key = scopedKey(extId, `fog:${id}`)
        const prev = store().overlays[key]?.primitives ?? []
        store().setOverlay(key, {
          extId,
          primitives: capPrimitives([
            ...prev,
            { type: "path", points: polygon, closed: true, fill: "#000000" },
          ]),
        })
      },
      "self.contribute": ({ contribution }) => {
        const revived = r.conn.revive(contribution) as Contribution
        const problem = validateContribution(revived)
        if (problem) throw new ExtensionError(problem, "invalid")
        const needs = CONTRIBUTION_PERMISSIONS[revived.type] as Permission
        const granted = store().installed[extId]?.granted ?? []
        if (!granted.includes(needs))
          throw new ExtensionError(
            `permission "${needs}" is needed for ${revived.type}`,
            "permission",
          )
        if (store().contributions.filter((c) => c.extId === extId).length >= LIMITS.contributions)
          throw new ExtensionError("too many contributions", "invalid")
        const id = "id" in revived ? revived.id : newId()
        const key = scopedKey(extId, `${revived.type === "tour" ? "tour" : revived.type}:${id}`)
        if (store().contributions.some((c) => c.key === key))
          throw new ExtensionError(`${revived.type} "${id}" is already registered`, "invalid")
        store().addContribution({ key, extId, contribution: revived })
        if (revived.type === "panel" || revived.type === "iframePanel")
          store().setPanel(scopedKey(extId, id), {})
        if (revived.type === "statusItem")
          store().setStatusItem(scopedKey(extId, id), {
            text: revived.text,
            tooltip: revived.tooltip,
          })
        return key
      },
      "self.withdraw": ({ id }) => {
        if (!id.startsWith(`${extId}::`)) return
        r.reactions.delete(id)
        r.validators.delete(id)
        store().removeContribution(id)
      },
      "self.requestPermission": async ({ permission }) => {
        const ext = store().installed[extId]
        if (!ext) return false
        if (ext.granted.includes(permission)) return true
        if (!(ext.manifest.optionalPermissions ?? []).includes(permission)) return false
        const ok = await this.ask<boolean>({
          id: newId("prompt"),
          extId,
          kind: "permission",
          permission,
        })
        if (ok) this.grant(extId, permission)
        return ok === true
      },
      "self.settings": () => this.settingsOf(store().installed[extId]),
      "self.setSetting": ({ key, value }) => {
        const ext = store().installed[extId]
        const spec = ext?.manifest.contributes?.settings?.[key]
        if (!ext || !spec) throw new ExtensionError(`no setting ${key}`, "notFound")
        store().patchInstalled(extId, { settings: { ...ext.settings, [key]: value } })
        void this.persist()
        r.conn.emit("settings.changed", this.settingsOf(store().installed[extId]))
      },
      "storage.get": ({ key }) => svc.storageGet(extId, storageKey(key)),
      "storage.set": ({ key, value }) => {
        const size = JSON.stringify(value ?? null).length
        if (size > LIMITS.storageValueBytes) throw new ExtensionError("value too big", "invalid")
        return svc.storageSet(extId, storageKey(key), value)
      },
      "storage.delete": ({ key }) => svc.storageDelete(extId, storageKey(key)),
      "storage.keys": () => svc.storageKeys(extId),
      "self.file": ({ path }) => svc.readFile(extId, safeRelative(path)),
      "self.t": ({ key }) => key,
    } satisfies MethodHandlers
  }

  private requireMapOrNull(): MapDocument | null {
    return useMapStore.getState().map
  }

  private requireOwn(extId: string, type: string, id: string): void {
    const key = scopedKey(extId, `${type}:${id}`)
    if (!useExtensionsStore.getState().contributions.some((c) => c.key === key))
      throw new ExtensionError(`no ${type} ${id}`, "notFound")
  }

  private folderOf(r: Running): string {
    if (!r.folder) throw new ExtensionError("ask for a folder first (folder.request)", "notFound")
    return r.folder
  }

  /** Record that the map uses this extension (for its data or its entity kinds). */
  private withUse(map: MapDocument, extId: string): MapDocument {
    const usesData =
      !!map.ext?.[extId] ||
      map.entities.some((e) => e.ext?.[extId] || kindOwner(e.toolId) === extId) ||
      map.levels.some((l) => l.ext?.[extId])
    const uses = map.extensions ?? []
    const listed = uses.some((u) => u.id === extId)
    if (usesData === listed) return map
    const version = useExtensionsStore.getState().installed[extId]?.manifest.version ?? "0.0.0"
    return {
      ...map,
      extensions: usesData ? [...uses, { id: extId, version }] : uses.filter((u) => u.id !== extId),
    }
  }

  private async callService(from: string, service: string, method: string, args: unknown[]) {
    const slash = service.indexOf("/")
    const owner = slash > 0 ? service.slice(0, slash) : ""
    const name = service.slice(slash + 1)
    const fromExt = useExtensionsStore.getState().installed[from]
    // Only declared dependencies (so the user sees who talks to whom on install).
    if (!fromExt?.manifest.dependencies?.[owner])
      throw new ExtensionError(`${owner} isn't a declared dependency`, "permission")
    const c = useExtensionsStore
      .getState()
      .contributions.find((x) => x.key === scopedKey(owner, `service:${name}`))
    if (!c || c.contribution.type !== "service")
      throw new ExtensionError(`no service ${service}`, "notFound")
    const fn = c.contribution.methods[method] as unknown as
      ((...a: unknown[]) => Promise<unknown>) | undefined
    if (typeof fn !== "function") throw new ExtensionError(`no method ${method}`, "notFound")
    return fn(...args)
  }

  private camera(target: {
    center?: { x: number; y: number }
    zoom?: number
    fit?: string[] | { x: number; y: number; w: number; h: number }
  }) {
    const map = this.requireMap()
    const view = useViewStore.getState()
    let zoom = target.zoom !== undefined ? clampZoom(target.zoom) : view.zoom
    let center = target.center
    if (target.fit) {
      let rect: { x: number; y: number; w: number; h: number } | null = null
      if (Array.isArray(target.fit)) {
        const ids = new Set(target.fit)
        const boxes = map.entities
          .filter((e) => ids.has(e.id))
          .map((e) => entityBounds(e, () => undefined))
        if (boxes.length) {
          const x0 = Math.min(...boxes.map((b) => b.x))
          const y0 = Math.min(...boxes.map((b) => b.y))
          const x1 = Math.max(...boxes.map((b) => b.x + b.w))
          const y1 = Math.max(...boxes.map((b) => b.y + b.h))
          rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
        }
      } else rect = target.fit
      if (rect) {
        const size = this.hooks.viewportSize?.() ?? { w: 1200, h: 800 }
        const fitZoom =
          (Math.min(size.w / Math.max(rect.w, 1), size.h / Math.max(rect.h, 1)) / BASE_TILE_PX) * 90
        zoom = clampZoom(Math.round(fitZoom))
        center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
      }
    }
    view.setZoom(zoom)
    if (center) {
      const t = BASE_TILE_PX * (zoom / 100)
      view.setPan(t * (center.x - map.width / 2), t * (map.height / 2 - center.y))
    }
  }

  private setView(toggle: ViewToggle, on: boolean) {
    const view = useViewStore.getState()
    if (toggle === "animations") {
      if (view.animations !== on) view.toggle("animations")
      return
    }
    if (!VIEW_KEYS.includes(toggle as ViewToggleKey))
      throw new ExtensionError(`no view toggle ${toggle}`, "invalid")
    if (view[toggle as ViewToggleKey] !== on) view.toggle(toggle as ViewToggleKey)
  }

  /** Current params of an extension's tool (for its handlers' context). */
  toolParams(toolId: string): Record<string, unknown> {
    return getToolParams(toolId)
  }
}

/** Runtime images (`render.registerImage`), served to the texture cache by id. */
const runtimeImages = new Map<string, { bytes: Uint8Array; mime: string; url: string | null }>()
const imageListeners = new Set<(id: string) => void>()

function registerRuntimeImage(id: string, bytes: Uint8Array, mime: string): void {
  const prev = runtimeImages.get(id)
  if (prev?.url) URL.revokeObjectURL(prev.url)
  runtimeImages.set(id, { bytes, mime, url: null })
  for (const l of imageListeners) l(id)
}

/** A blob URL for a runtime image (made on first use), or null when there's none. */
export function runtimeImageUrl(id: string): string | null {
  const img = runtimeImages.get(id)
  if (!img) return null
  if (!img.url && typeof URL.createObjectURL === "function")
    img.url = URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: img.mime }))
  return img.url
}

export function onRuntimeImage(listener: (id: string) => void): () => void {
  imageListeners.add(listener)
  return () => imageListeners.delete(listener)
}

/** Messages to iframe panels (posted by the panel component, which owns the frame). */
export const frameBus = {
  listeners: new Map<string, (message: unknown) => void>(),
  post(key: string, message: unknown) {
    this.listeners.get(key)?.(message)
  },
}

function capPrimitives(list: Primitive[]): Primitive[] {
  if (!Array.isArray(list)) throw new ExtensionError("primitives must be a list", "invalid")
  return list.slice(0, LIMITS.overlayPrimitives)
}

/** A storage key: printable, bounded. */
function storageKey(key: string): string {
  if (typeof key !== "string" || !/^[\w.:/-]{1,200}$/.test(key))
    throw new ExtensionError("storage keys are 1–200 chars of letters, digits and ._:/-", "invalid")
  return key
}

/** A relative path inside a granted folder or the extension: no escaping it. */
export function safeRelative(path: string): string {
  const p = String(path)
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.split("/").some((s) => s === ".."))
    throw new ExtensionError("paths must stay inside the folder", "invalid")
  return p
}

const folderName = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() ?? path

/** The id of a host method for UI listings of activity. */
export type { HostMethod }
