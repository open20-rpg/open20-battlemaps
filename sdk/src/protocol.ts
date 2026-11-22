/**
 * The wire protocol between an extension (in its sandbox) and the host
 * (the app). Everything goes through `postMessage` with structured-clone
 * data: there's no shared memory and no other channel, which is what makes
 * the sandbox the only door into the app.
 *
 * - The extension sends `req` (call a host method) and gets `res`.
 * - The host sends `call` (run one of the extension's callbacks) and gets `ret`.
 * - The host sends `event`s the extension subscribed to.
 */
import { type Contribution, type Serialized } from "./contributions"
import { type Manifest } from "./manifest"
import { type Permission } from "./permissions"
import {
  type ApplyResult,
  type AssetInfo,
  type AssetSearch,
  type CameraTarget,
  type EditorState,
  type Entity,
  type EntityQuery,
  type FileData,
  type MapChange,
  type MapOp,
  type MapSnapshot,
  type Notification,
  type PackInfo,
  type ParticleEmitter,
  type Primitive,
  type Rect,
  type Room,
  type UiNode,
  type Vec2,
  type ViewToggle,
  type Walkability,
} from "./types"

export interface ActivateInfo {
  manifest: Manifest
  granted: Permission[]
  lang: string
  apiVersion: string
  appVersion: string
  /** The extension's settings values (declared in its manifest). */
  settings: Record<string, unknown>
  /** The extension's own translations for `lang` (falling back to Spanish). */
  messages: Record<string, string>
  storeBuild: boolean
}

export type ToHost =
  | { t: "ready" }
  | { t: "req"; id: number; method: string; params: unknown }
  | { t: "ret"; id: number; ok: true; value: unknown }
  | { t: "ret"; id: number; ok: false; error: string }
  | { t: "log"; level: "debug" | "info" | "warn" | "error"; message: string }

export type ToExtension =
  | { t: "activate"; info: ActivateInfo }
  | { t: "res"; id: number; ok: true; value: unknown }
  | { t: "res"; id: number; ok: false; error: string; code?: ErrorCode }
  | { t: "call"; id: number; cb: number; args: unknown[] }
  | { t: "event"; name: EventName; payload: unknown }
  | { t: "deactivate" }

export type ErrorCode = "permission" | "invalid" | "notFound" | "timeout" | "cancelled" | "failed"

export interface HostEvents {
  "map.opened": MapSnapshot
  "map.closed": null
  "map.saved": { path: string | null }
  "map.changed": MapChange
  "editor.selection": string[]
  "editor.level": string | null
  "editor.tool": string | null
  "editor.pointer": Vec2 | null
  "editor.camera": { zoom: number; pan: Vec2 }
  "editor.view": { toggle: ViewToggle; on: boolean }
  "settings.changed": Record<string, unknown>
  "service.event": { from: string; name: string; payload: unknown }
  "ui.frameMessage": { panel: string; message: unknown }
  "app.language": string
  "net.message": { socket: string; data: string }
  "net.closed": { socket: string }
}
export type EventName = keyof HostEvents

export interface FolderEntry {
  name: string
  dir: boolean
  size: number
}

export interface TaskHandle {
  id: string
}

/**
 * Every host method: its params, its result. The runtime exposes them as
 * nicer namespaced functions; this map is what the host implements and
 * what the permission table below is checked against.
 */
export interface HostApi {
  // map:read
  "map.get": [null, MapSnapshot | null]
  "map.query": [EntityQuery, Entity[]]
  "map.hitTest": [{ point: Vec2; level?: string }, string[]]
  "map.history": [null, { canUndo: boolean; canRedo: boolean; labels: string[] }]
  "analysis.rooms": [{ level?: string }, Room[]]
  "analysis.walkability": [{ level?: string; resolution?: number }, Walkability]
  "analysis.path": [{ from: Vec2; to: Vec2; level?: string }, Vec2[] | null]
  "analysis.visibility": [{ from: Vec2; radius: number; level?: string }, Vec2[]]
  "render.toImage": [
    { area?: Rect; level?: string; pxPerTile?: number; format?: "png" | "jpeg" },
    FileData,
  ]
  // map:write
  "map.apply": [{ ops: MapOp[]; label?: string; merge?: boolean }, ApplyResult]
  "map.addReaction": [{ cb: Serialized<() => void> }, string]
  "map.addValidator": [{ cb: Serialized<() => void> }, string]
  "map.undo": [null, void]
  "map.redo": [null, void]
  // editor
  "editor.get": [null, EditorState]
  "editor.select": [{ ids: string[]; mode?: "set" | "add" | "remove" }, void]
  "editor.setLevel": [{ id: string }, void]
  "editor.setTool": [{ id: string; params?: Record<string, unknown> }, void]
  "editor.setToolParams": [{ id: string; params: Record<string, unknown> }, void]
  "editor.camera": [CameraTarget, void]
  "editor.setView": [{ toggle: ViewToggle; on: boolean }, void]
  "editor.setCursor": [{ cursor: string | null }, void]
  "editor.copy": [{ ids: string[] }, number]
  "editor.paste": [{ offset?: Vec2; at?: Vec2 }, string[]]
  "editor.trackPointer": [{ on: boolean }, void]
  // tools
  "tools.setDraft": [{ primitives: Primitive[] }, void]
  // render
  "render.setOverlay": [{ id: string; primitives: Primitive[]; level?: string }, void]
  "render.clearOverlay": [{ id: string }, void]
  "render.registerImage": [{ name: string; bytes: Uint8Array; mime: string }, string]
  "render.setParticles": [{ id: string; emitters: ParticleEmitter[] | null }, void]
  "render.invalidate": [{ ids?: string[] }, void]
  // ui
  "ui.notify": [Notification, string | null]
  "ui.confirm": [{ title: string; message: string; danger?: boolean }, boolean]
  "ui.prompt": [{ title: string; label: string; value?: string }, string | null]
  "ui.choose": [{ title: string; options: { id: string; label: string }[] }, string | null]
  "ui.updatePanel": [{ id: string; ui: Serialized<UiNode> }, void]
  "ui.openPanel": [{ id: string }, void]
  "ui.closePanel": [{ id: string }, void]
  "ui.postToFrame": [{ panel: string; message: unknown }, void]
  "ui.setStatus": [{ id: string; text: string; tooltip?: string }, void]
  "ui.startTour": [{ id: string }, void]
  "ui.progress": [{ title: string; cancellable?: boolean }, TaskHandle]
  "ui.progressUpdate": [{ id: string; value: number | null; message?: string }, void]
  "ui.progressEnd": [{ id: string }, void]
  "ui.theme": [null, { mode: "light" | "dark"; tokens: Record<string, string> }]
  // library:read
  "library.packs": [null, PackInfo[]]
  "library.search": [AssetSearch, AssetInfo[]]
  "library.asset": [{ id: string }, AssetInfo | null]
  "library.image": [{ id: string; size?: number }, FileData | null]
  // packs:write
  "packs.create": [{ name: string; author?: string }, string]
  "packs.importImages": [{ pack: string; files: FileData[]; category: string }, string[]]
  "packs.setTags": [{ asset: string; tags: string[] }, void]
  "packs.setMetadata": [{ asset: string; data: Record<string, unknown> }, void]
  // files
  "files.pick": [{ extensions?: string[]; multiple?: boolean }, FileData[]]
  "files.save": [{ file: FileData }, boolean]
  // folder
  "folder.request": [null, string | null]
  "folder.list": [{ path?: string }, FolderEntry[]]
  "folder.read": [{ path: string }, Uint8Array]
  "folder.write": [{ path: string; bytes: Uint8Array }, void]
  "folder.release": [null, void]
  // clipboard
  "clipboard.writeText": [{ text: string }, void]
  "clipboard.readText": [null, string]
  "clipboard.writeImage": [{ image: FileData }, void]
  // network:<host>
  "net.fetch": [
    { url: string; method?: string; headers?: Record<string, string>; body?: Uint8Array | string },
    { status: number; headers: Record<string, string>; body: Uint8Array },
  ]
  "net.socket": [{ url: string }, string]
  "net.socketSend": [{ id: string; data: string }, void]
  "net.socketClose": [{ id: string }, void]
  // openUrl
  "app.openUrl": [{ url: string }, boolean]
  // fonts
  "fonts.load": [{ family: string }, boolean]
  // services
  "services.call": [{ service: string; method: string; args: unknown[] }, unknown]
  "services.emit": [{ name: string; payload: unknown }, void]
  // preferences:read
  "app.preferences": [null, { language: string; units: string; gridColor: string }]
  // views
  "views.open": [{ id: string }, void]
  "views.close": [{ id: string }, void]
  "views.reveal": [{ id: string; polygon: Vec2[] }, void]
  // no permission: the extension's own things
  "self.contribute": [{ contribution: Serialized<Contribution> }, string]
  "self.withdraw": [{ id: string }, void]
  "self.subscribe": [{ event: EventName }, void]
  "self.unsubscribe": [{ event: EventName }, void]
  "self.requestPermission": [{ permission: Permission }, boolean]
  "self.settings": [null, Record<string, unknown>]
  "self.setSetting": [{ key: string; value: unknown }, void]
  "storage.get": [{ key: string }, unknown]
  "storage.set": [{ key: string; value: unknown }, void]
  "storage.delete": [{ key: string }, void]
  "storage.keys": [null, string[]]
  "self.file": [{ path: string }, Uint8Array]
  "self.t": [{ key: string; vars?: Record<string, string | number> }, string]
}

export type HostMethod = keyof HostApi
export type ParamsOf<M extends HostMethod> = HostApi[M][0]
export type ResultOf<M extends HostMethod> = HostApi[M][1]

/**
 * The permission each method needs (null: none, it only touches the
 * extension's own things). `network` stands for "the URL's host must be
 * granted as network:<host>" and is checked per request.
 */
export const METHOD_PERMISSIONS: Record<HostMethod, Permission | "network" | null> = {
  "map.get": "map:read",
  "map.query": "map:read",
  "map.hitTest": "map:read",
  "map.history": "map:read",
  "analysis.rooms": "map:read",
  "analysis.walkability": "map:read",
  "analysis.path": "map:read",
  "analysis.visibility": "map:read",
  "render.toImage": "map:read",
  "map.apply": "map:write",
  "map.addReaction": "map:write",
  "map.addValidator": "map:write",
  "map.undo": "map:write",
  "map.redo": "map:write",
  "editor.get": "editor",
  "editor.select": "editor",
  "editor.setLevel": "editor",
  "editor.setTool": "editor",
  "editor.setToolParams": "editor",
  "editor.camera": "editor",
  "editor.setView": "editor",
  "editor.setCursor": "editor",
  "editor.copy": "editor",
  "editor.paste": "map:write",
  "editor.trackPointer": "editor",
  "tools.setDraft": "tools",
  "render.setOverlay": "render",
  "render.clearOverlay": "render",
  "render.registerImage": "render",
  "render.setParticles": "render",
  "render.invalidate": "render",
  "ui.notify": "ui",
  "ui.confirm": "ui",
  "ui.prompt": "ui",
  "ui.choose": "ui",
  "ui.updatePanel": "ui",
  "ui.openPanel": "ui",
  "ui.closePanel": "ui",
  "ui.postToFrame": "ui:iframe",
  "ui.setStatus": "ui",
  "ui.startTour": "ui",
  "ui.progress": "ui",
  "ui.progressUpdate": "ui",
  "ui.progressEnd": "ui",
  "ui.theme": "ui",
  "library.packs": "library:read",
  "library.search": "library:read",
  "library.asset": "library:read",
  "library.image": "library:read",
  "packs.create": "packs:write",
  "packs.importImages": "packs:write",
  "packs.setTags": "packs:write",
  "packs.setMetadata": "packs:write",
  "files.pick": "files",
  "files.save": "files",
  "folder.request": "folder",
  "folder.list": "folder",
  "folder.read": "folder",
  "folder.write": "folder",
  "folder.release": "folder",
  "clipboard.writeText": "clipboard",
  "clipboard.readText": "clipboard",
  "clipboard.writeImage": "clipboard",
  "net.fetch": "network",
  "net.socket": "network",
  "net.socketSend": "network",
  "net.socketClose": "network",
  "app.openUrl": "openUrl",
  "fonts.load": "fonts",
  "services.call": "services",
  "services.emit": "services",
  "app.preferences": "preferences:read",
  "views.open": "views",
  "views.close": "views",
  "views.reveal": "views",
  "self.contribute": null,
  "self.withdraw": null,
  "self.subscribe": null,
  "self.unsubscribe": null,
  "self.requestPermission": null,
  "self.settings": null,
  "self.setSetting": null,
  "storage.get": null,
  "storage.set": null,
  "storage.delete": null,
  "storage.keys": null,
  "self.file": null,
  "self.t": null,
}

/** Events that need a permission to subscribe to. */
export const EVENT_PERMISSIONS: Record<EventName, Permission | null> = {
  "map.opened": "map:read",
  "map.closed": "map:read",
  "map.saved": "map:read",
  "map.changed": "map:read",
  "editor.selection": "editor",
  "editor.level": "editor",
  "editor.tool": "editor",
  "editor.pointer": "editor",
  "editor.camera": "editor",
  "editor.view": "editor",
  "settings.changed": null,
  "service.event": "services",
  "ui.frameMessage": "ui:iframe",
  "app.language": null,
  "net.message": null,
  "net.closed": null,
}

export class ExtensionError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode = "failed",
  ) {
    super(message)
    this.name = "ExtensionError"
  }
}

/**
 * Something that carries messages both ways: a worker, a MessagePort, or
 * an in-process pair for tests.
 */
export interface Endpoint<In, Out> {
  post(message: Out, transfer?: Transferable[]): void
  listen(handler: (message: In) => void): () => void
}

/** Two connected in-process endpoints (tests, and the SDK's test host). */
export function endpointPair<A, B>(): [Endpoint<A, B>, Endpoint<B, A>] {
  const aHandlers = new Set<(m: A) => void>()
  const bHandlers = new Set<(m: B) => void>()
  // Async delivery like a real port, and a structured clone like postMessage.
  const deliver = <T>(handlers: Set<(m: T) => void>, message: T) =>
    queueMicrotask(() => {
      const copy = structuredClone(message)
      for (const h of handlers) h(copy)
    })
  const a: Endpoint<A, B> = {
    post: (m) => deliver(bHandlers, m),
    listen: (h) => (aHandlers.add(h), () => aHandlers.delete(h)),
  }
  const b: Endpoint<B, A> = {
    post: (m) => deliver(aHandlers, m),
    listen: (h) => (bHandlers.add(h), () => bHandlers.delete(h)),
  }
  return [a, b]
}
