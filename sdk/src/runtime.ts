/**
 * The extension side of the SDK: `defineExtension` and the context it
 * hands to `activate`. It only speaks the protocol (protocol.ts) through
 * an endpoint; it holds no privilege of its own. Inside the app's sandbox
 * the endpoint is the worker's port; in tests, the SDK's test host.
 */
import {
  isCallbackRef,
  type AssetBehaviorContribution,
  type AssetMetadataContribution,
  type BrushTipContribution,
  type CommandContribution,
  type ContextMenuContribution,
  type Contribution,
  type DocumentHookContribution,
  type DungeondraftTranslatorContribution,
  type EntityTypeContribution,
  type ExportFormatContribution,
  type ExportHookContribution,
  type ExportProfileContribution,
  type FileHandlerContribution,
  type FillShaderContribution,
  type GeneratorContribution,
  type GridTypeContribution,
  type IframePanelContribution,
  type ImportFormatContribution,
  type LayerContribution,
  type LayerShaderContribution,
  type LibraryTabContribution,
  type LightTypeContribution,
  type MapSizeContribution,
  type OverlayToggleContribution,
  type PanelContribution,
  type ParticlesContribution,
  type PathStyleContribution,
  type PlacementRuleContribution,
  type PostShaderContribution,
  type PropertiesContribution,
  type ScatterDistributionContribution,
  type SelectionModeContribution,
  type ServiceContribution,
  type ShaderContribution,
  type SnapProviderContribution,
  type StatsContribution,
  type StatusItemContribution,
  type StyleFunctionContribution,
  type StyleRuleContribution,
  type TerrainRuleContribution,
  type ToolContribution,
  type TourContribution,
  type ViewContribution,
  type WallStyleContribution,
  type WaterStyleContribution,
} from "./contributions"
import { type Permission } from "./permissions"
import {
  ExtensionError,
  type ActivateInfo,
  type Endpoint,
  type EventName,
  type HostEvents,
  type HostMethod,
  type ParamsOf,
  type ResultOf,
  type ToExtension,
  type ToHost,
} from "./protocol"
import {
  type Entity,
  type EntityPatch,
  type FileData,
  type MapChange,
  type MapOp,
  type NewEntity,
  type UiNode,
  type Vec2,
} from "./types"

type Awaitable<T> = T | Promise<T>

export interface Disposable {
  dispose(): void
}

/** Drop the `type` tag: the typed helpers add it. */
type Spec<C extends Contribution> = Omit<C, "type">

export type ReactionHandler = (change: MapChange) => Awaitable<MapOp[] | void>
export type ValidatorHandler = (
  change: MapChange,
  entities: Entity[],
) => Awaitable<{ veto: string } | null | void>

/**
 * Everything an extension can do, by area. Each call is checked by the host
 * against the extension's permissions: a missing one rejects with an
 * `ExtensionError` of code "permission".
 */
export interface ExtensionContext {
  readonly manifest: ActivateInfo["manifest"]
  readonly lang: string
  readonly appVersion: string
  readonly storeBuild: boolean
  /** Whether a permission is granted right now. */
  has(permission: Permission): boolean
  /** Ask the user for an optional permission (declared in the manifest). */
  requestPermission(permission: Permission): Promise<boolean>
  /** The extension's own translation of `key` (its `contributes.locales`). */
  t(key: string, vars?: Record<string, string | number>): string
  readonly log: Record<"debug" | "info" | "warn" | "error", (...args: unknown[]) => void>
  on<E extends EventName>(event: E, handler: (payload: HostEvents[E]) => void): Disposable
  /** Register any contribution (the helpers below are typed shortcuts). */
  contribute(contribution: Contribution): Promise<Disposable>

  map: {
    get(): Promise<ResultOf<"map.get">>
    query(q?: ParamsOf<"map.query">): Promise<Entity[]>
    entity(id: string): Promise<Entity | null>
    hitTest(point: Vec2, level?: string): Promise<string[]>
    /** Apply changes as ONE undoable step. */
    apply(ops: MapOp[], opts?: { label?: string }): Promise<ResultOf<"map.apply">>
    add(entities: NewEntity[], opts?: { label?: string }): Promise<string[]>
    update(id: string, patch: EntityPatch): Promise<void>
    remove(ids: string[]): Promise<void>
    setData(id: string, data: Record<string, unknown> | null): Promise<void>
    setMapData(data: Record<string, unknown> | null): Promise<void>
    onChange(handler: (change: MapChange) => void): Disposable
    /** Ops returned are added to the same undo step as the change. */
    addReaction(handler: ReactionHandler): Promise<Disposable>
    /** A veto undoes the change and shows its reason. */
    addValidator(handler: ValidatorHandler): Promise<Disposable>
    undo(): Promise<void>
    redo(): Promise<void>
    history(): Promise<ResultOf<"map.history">>
  }
  analysis: {
    rooms(level?: string): Promise<ResultOf<"analysis.rooms">>
    walkability(opts?: ParamsOf<"analysis.walkability">): Promise<ResultOf<"analysis.walkability">>
    path(from: Vec2, to: Vec2, level?: string): Promise<Vec2[] | null>
    visibility(from: Vec2, radius: number, level?: string): Promise<Vec2[]>
  }
  editor: {
    get(): Promise<ResultOf<"editor.get">>
    select(ids: string[], mode?: "set" | "add" | "remove"): Promise<void>
    setLevel(id: string): Promise<void>
    setTool(id: string, params?: Record<string, unknown>): Promise<void>
    setToolParams(id: string, params: Record<string, unknown>): Promise<void>
    camera(target: ParamsOf<"editor.camera">): Promise<void>
    setView(toggle: ParamsOf<"editor.setView">["toggle"], on: boolean): Promise<void>
    setCursor(cursor: string | null): Promise<void>
    copy(ids: string[]): Promise<number>
    paste(opts?: ParamsOf<"editor.paste">): Promise<string[]>
    onPointer(handler: (p: Vec2 | null) => void): Disposable
    snapProvider(spec: Spec<SnapProviderContribution>): Promise<Disposable>
  }
  tools: {
    register(spec: Spec<ToolContribution>): Promise<Disposable>
    properties(spec: Spec<PropertiesContribution>): Promise<Disposable>
    selectionMode(spec: Spec<SelectionModeContribution>): Promise<Disposable>
    brushTip(spec: Spec<BrushTipContribution>): Promise<Disposable>
    scatterDistribution(spec: Spec<ScatterDistributionContribution>): Promise<Disposable>
    wallStyle(spec: Spec<WallStyleContribution>): Promise<Disposable>
    pathStyle(spec: Spec<PathStyleContribution>): Promise<Disposable>
    terrainRule(spec: Spec<TerrainRuleContribution>): Promise<Disposable>
    waterStyle(spec: Spec<WaterStyleContribution>): Promise<Disposable>
    placementRule(spec: Spec<PlacementRuleContribution>): Promise<Disposable>
    assetBehavior(spec: Spec<AssetBehaviorContribution>): Promise<Disposable>
    /** What the active tool draws over the map while being used. */
    setDraft(primitives: ParamsOf<"tools.setDraft">["primitives"]): Promise<void>
  }
  generators: {
    register(spec: Spec<GeneratorContribution>): Promise<Disposable>
    newMapPreset(spec: Spec<MapSizeContribution>): Promise<Disposable>
  }
  render: {
    styleRule(spec: Spec<StyleRuleContribution>): Promise<Disposable>
    styleFunction(spec: Spec<StyleFunctionContribution>): Promise<Disposable>
    shader(spec: Spec<ShaderContribution>): Promise<Disposable>
    layerShader(spec: Spec<LayerShaderContribution>): Promise<Disposable>
    postShader(spec: Spec<PostShaderContribution>): Promise<Disposable>
    fillShader(spec: Spec<FillShaderContribution>): Promise<Disposable>
    entityType(spec: Spec<EntityTypeContribution>): Promise<Disposable>
    layer(spec: Spec<LayerContribution>): Promise<Disposable>
    lightType(spec: Spec<LightTypeContribution>): Promise<Disposable>
    particles(spec: Spec<ParticlesContribution>): Promise<Disposable>
    gridType(spec: Spec<GridTypeContribution>): Promise<Disposable>
    setOverlay(
      id: string,
      primitives: ParamsOf<"render.setOverlay">["primitives"],
      level?: string,
    ): Promise<void>
    clearOverlay(id: string): Promise<void>
    /** Register an image made at runtime; returns its asset id. */
    registerImage(name: string, bytes: Uint8Array, mime?: string): Promise<string>
    setParticles(id: string, emitters: ParamsOf<"render.setParticles">["emitters"]): Promise<void>
    toImage(opts?: ParamsOf<"render.toImage">): Promise<FileData>
    /** Redraw entities whose look depends on something outside their data. */
    invalidate(ids?: string[]): Promise<void>
  }
  ui: {
    command(spec: Spec<CommandContribution>): Promise<Disposable>
    contextMenu(spec: Spec<ContextMenuContribution>): Promise<Disposable>
    panel(spec: Spec<PanelContribution>): Promise<Disposable>
    iframePanel(spec: Spec<IframePanelContribution>): Promise<Disposable>
    statusItem(spec: Spec<StatusItemContribution>): Promise<Disposable>
    tour(spec: Spec<TourContribution>): Promise<Disposable>
    viewToggle(spec: Spec<OverlayToggleContribution>): Promise<Disposable>
    notify(n: ParamsOf<"ui.notify"> | string): Promise<string | null>
    confirm(title: string, message: string, danger?: boolean): Promise<boolean>
    prompt(title: string, label: string, value?: string): Promise<string | null>
    choose(title: string, options: { id: string; label: string }[]): Promise<string | null>
    updatePanel(id: string, ui: UiNode): Promise<void>
    openPanel(id: string): Promise<void>
    closePanel(id: string): Promise<void>
    postToFrame(panel: string, message: unknown): Promise<void>
    setStatus(id: string, text: string, tooltip?: string): Promise<void>
    startTour(id: string): Promise<void>
    /** Run `task` with a progress entry in the status bar. */
    withProgress<T>(
      title: string,
      task: (report: (value: number | null, message?: string) => void) => Promise<T>,
    ): Promise<T>
    theme(): Promise<ResultOf<"ui.theme">>
  }
  library: {
    packs(): Promise<ResultOf<"library.packs">>
    search(q: ParamsOf<"library.search">): Promise<ResultOf<"library.search">>
    asset(id: string): Promise<ResultOf<"library.asset">>
    image(id: string, size?: number): Promise<FileData | null>
    tab(spec: Spec<LibraryTabContribution>): Promise<Disposable>
  }
  packs: {
    create(name: string, author?: string): Promise<string>
    importImages(pack: string, files: FileData[], category: string): Promise<string[]>
    setTags(asset: string, tags: string[]): Promise<void>
    setMetadata(asset: string, data: Record<string, unknown>): Promise<void>
    metadata(spec: Spec<AssetMetadataContribution>): Promise<Disposable>
  }
  files: {
    pick(opts?: ParamsOf<"files.pick">): Promise<FileData[]>
    save(file: FileData): Promise<boolean>
    importFormat(spec: Spec<ImportFormatContribution>): Promise<Disposable>
    exportFormat(spec: Spec<ExportFormatContribution>): Promise<Disposable>
    exportProfile(spec: Spec<ExportProfileContribution>): Promise<Disposable>
    exportHook(spec: Spec<ExportHookContribution>): Promise<Disposable>
    documentHook(spec: Spec<DocumentHookContribution>): Promise<Disposable>
    handler(spec: Spec<FileHandlerContribution>): Promise<Disposable>
    dungeondraftTranslator(spec: Spec<DungeondraftTranslatorContribution>): Promise<Disposable>
  }
  folder: {
    request(): Promise<string | null>
    list(path?: string): Promise<ResultOf<"folder.list">>
    read(path: string): Promise<Uint8Array>
    write(path: string, bytes: Uint8Array): Promise<void>
    release(): Promise<void>
  }
  clipboard: {
    writeText(text: string): Promise<void>
    readText(): Promise<string>
    writeImage(image: FileData): Promise<void>
  }
  net: {
    fetch(url: string, init?: Omit<ParamsOf<"net.fetch">, "url">): Promise<ResultOf<"net.fetch">>
    socket(
      url: string,
      onMessage: (data: string) => void,
      onClose?: () => void,
    ): Promise<{ send(data: string): Promise<void>; close(): Promise<void> }>
  }
  app: {
    openUrl(url: string): Promise<boolean>
    preferences(): Promise<ResultOf<"app.preferences">>
  }
  fonts: { load(family: string): Promise<boolean> }
  services: {
    provide(spec: Spec<ServiceContribution>): Promise<Disposable>
    call<T = unknown>(service: string, method: string, ...args: unknown[]): Promise<T>
    /** A proxy whose methods call the service. */
    use<T extends Record<string, (...args: never[]) => Promise<unknown>>>(service: string): T
    emit(name: string, payload: unknown): Promise<void>
    onEvent(handler: (e: HostEvents["service.event"]) => void): Disposable
  }
  views: {
    register(spec: Spec<ViewContribution>): Promise<Disposable>
    open(id: string): Promise<void>
    close(id: string): Promise<void>
    reveal(id: string, polygon: Vec2[]): Promise<void>
  }
  stats: { register(spec: Spec<StatsContribution>): Promise<Disposable> }
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
    keys(): Promise<string[]>
  }
  settings: {
    get(): Record<string, unknown>
    set(key: string, value: unknown): Promise<void>
    onChange(handler: (values: Record<string, unknown>) => void): Disposable
  }
  /** A file bundled in the extension. */
  file(path: string): Promise<Uint8Array>
}

export interface ExtensionDefinition {
  activate(ctx: ExtensionContext): Awaitable<void>
  deactivate?(): Awaitable<void>
}

/**
 * Connect a definition to the host through `endpoint`. The app's sandbox
 * does it by itself (see `defineExtension`); tests call it directly.
 */
export function runExtension(
  def: ExtensionDefinition,
  endpoint: Endpoint<ToExtension, ToHost>,
): { stop(): void; context: Promise<ExtensionContext> } {
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>()
  const callbacks = new Map<number, (...args: unknown[]) => unknown>()
  const listeners = new Map<EventName, Set<(payload: unknown) => void>>()
  let nextReq = 1
  let nextCb = 1
  let info: ActivateInfo | null = null
  let settings: Record<string, unknown> = {}
  let resolveCtx!: (ctx: ExtensionContext) => void
  const context = new Promise<ExtensionContext>((r) => (resolveCtx = r))

  const request = <M extends HostMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> =>
    new Promise((resolve, reject) => {
      const id = nextReq++
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      endpoint.post({ t: "req", id, method, params: serialize(params) })
    })

  /** Functions become callback refs; everything else is copied as is. */
  const serialize = (value: unknown, cbs?: number[]): unknown => {
    if (typeof value === "function") {
      const id = nextCb++
      callbacks.set(id, value as (...args: unknown[]) => unknown)
      cbs?.push(id)
      return { $cb: id }
    }
    if (Array.isArray(value)) return value.map((v) => serialize(v, cbs))
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) out[k] = serialize(v, cbs)
      return out
    }
    return value
  }

  const subscribe = <E extends EventName>(
    event: E,
    handler: (payload: HostEvents[E]) => void,
  ): Disposable => {
    let set = listeners.get(event)
    if (!set) {
      set = new Set()
      listeners.set(event, set)
      void request("self.subscribe", { event }).catch(() => listeners.delete(event))
    }
    set.add(handler as (payload: unknown) => void)
    return {
      dispose: () => {
        set.delete(handler as (payload: unknown) => void)
        if (set.size === 0 && listeners.get(event) === set) {
          listeners.delete(event)
          void request("self.unsubscribe", { event }).catch(() => {})
        }
      },
    }
  }

  const contribute = async (contribution: Contribution): Promise<Disposable> => {
    const cbs: number[] = []
    const serialized = serialize(contribution, cbs) as ParamsOf<"self.contribute">["contribution"]
    let key: string
    try {
      key = await request("self.contribute", { contribution: serialized })
    } catch (e) {
      for (const id of cbs) callbacks.delete(id)
      throw e
    }
    return {
      dispose: () => {
        for (const id of cbs) callbacks.delete(id)
        void request("self.withdraw", { id: key }).catch(() => {})
      },
    }
  }

  const typed =
    <C extends Contribution>(type: C["type"]) =>
    (spec: Spec<C>) =>
      contribute({ ...spec, type } as C)

  /** Register a single callback with the host (reactions, validators). */
  const withCallback = async (
    method: "map.addReaction" | "map.addValidator",
    fn: (...args: never[]) => unknown,
  ): Promise<Disposable> => {
    const cbs: number[] = []
    const cb = serialize(fn, cbs) as { $cb: number }
    const key = await request(method, { cb })
    return {
      dispose: () => {
        for (const id of cbs) callbacks.delete(id)
        void request("self.withdraw", { id: key }).catch(() => {})
      },
    }
  }

  const log =
    (level: "debug" | "info" | "warn" | "error") =>
    (...args: unknown[]) =>
      endpoint.post({
        t: "log",
        level,
        message: args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" "),
      })

  const buildContext = (activate: ActivateInfo): ExtensionContext => {
    settings = { ...activate.settings }
    const granted = new Set<Permission>(activate.granted)
    const socketHandlers = new Map<string, { onMessage(d: string): void; onClose?(): void }>()
    let socketsListening = false
    const listenSockets = () => {
      if (socketsListening) return
      socketsListening = true
      subscribe("net.message", (m) => socketHandlers.get(m.socket)?.onMessage(m.data))
      subscribe("net.closed", (m) => {
        socketHandlers.get(m.socket)?.onClose?.()
        socketHandlers.delete(m.socket)
      })
    }
    const ctx: ExtensionContext = {
      manifest: activate.manifest,
      lang: activate.lang,
      appVersion: activate.appVersion,
      storeBuild: activate.storeBuild,
      has: (p) => granted.has(p),
      requestPermission: async (p) => {
        const ok = await request("self.requestPermission", { permission: p })
        if (ok) granted.add(p)
        return ok
      },
      t: (key, vars) => {
        let text = activate.messages[key] ?? key
        for (const [k, v] of Object.entries(vars ?? {}))
          text = text.split(`{{${k}}}`).join(String(v))
        return text
      },
      log: { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") },
      on: subscribe,
      contribute,
      map: {
        get: () => request("map.get", null),
        query: (q = {}) => request("map.query", q),
        entity: async (id) => (await request("map.query", { ids: [id], level: "all" }))[0] ?? null,
        hitTest: (point, level) => request("map.hitTest", { point, level }),
        apply: (ops, opts) => request("map.apply", { ops, label: opts?.label }),
        add: async (entities, opts) =>
          (await request("map.apply", { ops: [{ op: "add", entities }], label: opts?.label }))
            .created,
        update: async (id, patch) => {
          await request("map.apply", { ops: [{ op: "update", id, patch }] })
        },
        remove: async (ids) => {
          await request("map.apply", { ops: [{ op: "remove", ids }] })
        },
        setData: async (id, data) => {
          await request("map.apply", { ops: [{ op: "setData", id, data }] })
        },
        setMapData: async (data) => {
          await request("map.apply", { ops: [{ op: "setMapData", data }] })
        },
        onChange: (h) => subscribe("map.changed", h),
        addReaction: (h) => withCallback("map.addReaction", h),
        addValidator: (h) => withCallback("map.addValidator", h),
        undo: () => request("map.undo", null),
        redo: () => request("map.redo", null),
        history: () => request("map.history", null),
      },
      analysis: {
        rooms: (level) => request("analysis.rooms", { level }),
        walkability: (opts = {}) => request("analysis.walkability", opts),
        path: (from, to, level) => request("analysis.path", { from, to, level }),
        visibility: (from, radius, level) =>
          request("analysis.visibility", { from, radius, level }),
      },
      editor: {
        get: () => request("editor.get", null),
        select: (ids, mode) => request("editor.select", { ids, mode }),
        setLevel: (id) => request("editor.setLevel", { id }),
        setTool: (id, params) => request("editor.setTool", { id, params }),
        setToolParams: (id, params) => request("editor.setToolParams", { id, params }),
        camera: (target) => request("editor.camera", target),
        setView: (toggle, on) => request("editor.setView", { toggle, on }),
        setCursor: (cursor) => request("editor.setCursor", { cursor }),
        copy: (ids) => request("editor.copy", { ids }),
        paste: (opts = {}) => request("editor.paste", opts),
        onPointer: (h) => {
          void request("editor.trackPointer", { on: true }).catch(() => {})
          const sub = subscribe("editor.pointer", h)
          return {
            dispose: () => {
              sub.dispose()
              if (!listeners.has("editor.pointer"))
                void request("editor.trackPointer", { on: false }).catch(() => {})
            },
          }
        },
        snapProvider: typed<SnapProviderContribution>("snapProvider"),
      },
      tools: {
        register: typed<ToolContribution>("tool"),
        properties: typed<PropertiesContribution>("properties"),
        selectionMode: typed<SelectionModeContribution>("selectionMode"),
        brushTip: typed<BrushTipContribution>("brushTip"),
        scatterDistribution: typed<ScatterDistributionContribution>("scatterDistribution"),
        wallStyle: typed<WallStyleContribution>("wallStyle"),
        pathStyle: typed<PathStyleContribution>("pathStyle"),
        terrainRule: typed<TerrainRuleContribution>("terrainRule"),
        waterStyle: typed<WaterStyleContribution>("waterStyle"),
        placementRule: typed<PlacementRuleContribution>("placementRule"),
        assetBehavior: typed<AssetBehaviorContribution>("assetBehavior"),
        setDraft: (primitives) => request("tools.setDraft", { primitives }),
      },
      generators: {
        register: typed<GeneratorContribution>("generator"),
        newMapPreset: typed<MapSizeContribution>("newMapPreset"),
      },
      render: {
        styleRule: typed<StyleRuleContribution>("styleRule"),
        styleFunction: typed<StyleFunctionContribution>("styleFunction"),
        shader: typed<ShaderContribution>("shader"),
        layerShader: typed<LayerShaderContribution>("layerShader"),
        postShader: typed<PostShaderContribution>("postShader"),
        fillShader: typed<FillShaderContribution>("fillShader"),
        entityType: typed<EntityTypeContribution>("entityType"),
        layer: typed<LayerContribution>("layer"),
        lightType: typed<LightTypeContribution>("lightType"),
        particles: typed<ParticlesContribution>("particles"),
        gridType: typed<GridTypeContribution>("gridType"),
        setOverlay: (id, primitives, level) =>
          request("render.setOverlay", { id, primitives, level }),
        clearOverlay: (id) => request("render.clearOverlay", { id }),
        registerImage: (name, bytes, mime = "image/png") =>
          request("render.registerImage", { name, bytes, mime }),
        setParticles: (id, emitters) => request("render.setParticles", { id, emitters }),
        toImage: (opts = {}) => request("render.toImage", opts),
        invalidate: (ids) => request("render.invalidate", { ids }),
      },
      ui: {
        command: typed<CommandContribution>("command"),
        contextMenu: typed<ContextMenuContribution>("contextMenu"),
        panel: typed<PanelContribution>("panel"),
        iframePanel: typed<IframePanelContribution>("iframePanel"),
        statusItem: typed<StatusItemContribution>("statusItem"),
        tour: typed<TourContribution>("tour"),
        viewToggle: typed<OverlayToggleContribution>("viewToggle"),
        notify: (n) => request("ui.notify", typeof n === "string" ? { message: n } : n),
        confirm: (title, message, danger) => request("ui.confirm", { title, message, danger }),
        prompt: (title, label, value) => request("ui.prompt", { title, label, value }),
        choose: (title, options) => request("ui.choose", { title, options }),
        updatePanel: (id, ui) =>
          request("ui.updatePanel", { id, ui: ui as unknown as ParamsOf<"ui.updatePanel">["ui"] }),
        openPanel: (id) => request("ui.openPanel", { id }),
        closePanel: (id) => request("ui.closePanel", { id }),
        postToFrame: (panel, message) => request("ui.postToFrame", { panel, message }),
        setStatus: (id, text, tooltip) => request("ui.setStatus", { id, text, tooltip }),
        startTour: (id) => request("ui.startTour", { id }),
        withProgress: async (title, task) => {
          const { id } = await request("ui.progress", { title })
          try {
            return await task((value, message) => {
              void request("ui.progressUpdate", { id, value, message }).catch(() => {})
            })
          } finally {
            await request("ui.progressEnd", { id }).catch(() => {})
          }
        },
        theme: () => request("ui.theme", null),
      },
      library: {
        packs: () => request("library.packs", null),
        search: (q) => request("library.search", q),
        asset: (id) => request("library.asset", { id }),
        image: (id, size) => request("library.image", { id, size }),
        tab: typed<LibraryTabContribution>("libraryTab"),
      },
      packs: {
        create: (name, author) => request("packs.create", { name, author }),
        importImages: (pack, files, category) =>
          request("packs.importImages", { pack, files, category }),
        setTags: (asset, tags) => request("packs.setTags", { asset, tags }),
        setMetadata: (asset, data) => request("packs.setMetadata", { asset, data }),
        metadata: typed<AssetMetadataContribution>("assetMetadata"),
      },
      files: {
        pick: (opts = {}) => request("files.pick", opts),
        save: (file) => request("files.save", { file }),
        importFormat: typed<ImportFormatContribution>("importFormat"),
        exportFormat: typed<ExportFormatContribution>("exportFormat"),
        exportProfile: typed<ExportProfileContribution>("exportProfile"),
        exportHook: typed<ExportHookContribution>("exportHook"),
        documentHook: typed<DocumentHookContribution>("documentHook"),
        handler: typed<FileHandlerContribution>("fileHandler"),
        dungeondraftTranslator: typed<DungeondraftTranslatorContribution>("dungeondraftTranslator"),
      },
      folder: {
        request: () => request("folder.request", null),
        list: (path) => request("folder.list", { path }),
        read: (path) => request("folder.read", { path }),
        write: (path, bytes) => request("folder.write", { path, bytes }),
        release: () => request("folder.release", null),
      },
      clipboard: {
        writeText: (text) => request("clipboard.writeText", { text }),
        readText: () => request("clipboard.readText", null),
        writeImage: (image) => request("clipboard.writeImage", { image }),
      },
      net: {
        fetch: (url, init = {}) => request("net.fetch", { url, ...init }),
        socket: async (url, onMessage, onClose) => {
          listenSockets()
          const id = await request("net.socket", { url })
          socketHandlers.set(id, { onMessage, onClose })
          return {
            send: (data) => request("net.socketSend", { id, data }),
            close: () => request("net.socketClose", { id }),
          }
        },
      },
      app: {
        openUrl: (url) => request("app.openUrl", { url }),
        preferences: () => request("app.preferences", null),
      },
      fonts: { load: (family) => request("fonts.load", { family }) },
      services: {
        provide: typed<ServiceContribution>("service"),
        call: <T>(service: string, method: string, ...args: unknown[]) =>
          request("services.call", { service, method, args }) as Promise<T>,
        use: <T extends Record<string, (...args: never[]) => Promise<unknown>>>(service: string) =>
          new Proxy({} as T, {
            get: (_t, method) =>
              typeof method === "string"
                ? (...args: unknown[]) => request("services.call", { service, method, args })
                : undefined,
          }),
        emit: (name, payload) => request("services.emit", { name, payload }),
        onEvent: (h) => subscribe("service.event", h),
      },
      views: {
        register: typed<ViewContribution>("view"),
        open: (id) => request("views.open", { id }),
        close: (id) => request("views.close", { id }),
        reveal: (id, polygon) => request("views.reveal", { id, polygon }),
      },
      stats: { register: typed<StatsContribution>("stats") },
      storage: {
        get: <T>(key: string) => request("storage.get", { key }) as Promise<T | undefined>,
        set: (key, value) => request("storage.set", { key, value }),
        delete: (key) => request("storage.delete", { key }),
        keys: () => request("storage.keys", null),
      },
      settings: {
        get: () => ({ ...settings }),
        set: async (key, value) => {
          await request("self.setSetting", { key, value })
          settings = { ...settings, [key]: value }
        },
        onChange: (h) => subscribe("settings.changed", h),
      },
      file: (path) => request("self.file", { path }),
    }
    return ctx
  }

  const runCallback = async (id: number, cb: number, args: unknown[]) => {
    const fn = callbacks.get(cb)
    try {
      if (!fn) throw new ExtensionError(`callback ${cb} is gone`, "notFound")
      const value = await fn(...args)
      endpoint.post({ t: "ret", id, ok: true, value: serialize(value) })
    } catch (e) {
      endpoint.post({ t: "ret", id, ok: false, error: errorText(e) })
    }
  }

  const stop = endpoint.listen((msg) => {
    switch (msg.t) {
      case "activate": {
        info = msg.info
        const ctx = buildContext(info)
        resolveCtx(ctx)
        Promise.resolve()
          .then(() => def.activate(ctx))
          .then(
            () => endpoint.post({ t: "ready" }),
            (e) => {
              log("error")(`activate failed: ${errorText(e)}`)
              endpoint.post({ t: "ready" })
            },
          )
        return
      }
      case "res": {
        const p = pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        if (msg.ok) p.resolve(msg.value)
        else p.reject(new ExtensionError(msg.error, msg.code))
        return
      }
      case "call":
        void runCallback(msg.id, msg.cb, msg.args)
        return
      case "event":
        if (msg.name === "settings.changed")
          settings = { ...(msg.payload as Record<string, unknown>) }
        for (const h of listeners.get(msg.name) ?? []) h(msg.payload)
        return
      case "deactivate":
        void Promise.resolve(def.deactivate?.()).finally(() => stop())
        return
    }
  })

  return { stop, context }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Set by the app's sandbox bootstrap before the extension's code runs. */
interface SandboxGlobal {
  __open20Endpoint?: Endpoint<ToExtension, ToHost>
}

/**
 * Declare an extension. In the app's sandbox it starts right away; in tests
 * the returned definition is run against the SDK's test host.
 */
export function defineExtension(def: ExtensionDefinition): ExtensionDefinition {
  const endpoint = (globalThis as SandboxGlobal).__open20Endpoint
  if (endpoint) runExtension(def, endpoint)
  return def
}

export { isCallbackRef }
