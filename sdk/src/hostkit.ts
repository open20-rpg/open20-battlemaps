/**
 * The host side of the protocol, without any app: request dispatch with
 * the permission check, callbacks into the extension with a timeout, and
 * event subscriptions. The app's host and the SDK's test host both build
 * on it, so the rules extensions run under are the same in tests and in
 * the app.
 */
import { isCallbackRef } from "./contributions"
import { type Permission } from "./permissions"
import { allowsUrl } from "./permissions"
import {
  EVENT_PERMISSIONS,
  ExtensionError,
  METHOD_PERMISSIONS,
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

/** A function standing for one of the extension's callbacks. */
export type RemoteFn = ((...args: unknown[]) => Promise<unknown>) & { cbId: number }

export type MethodHandlers = {
  [M in HostMethod]?: (params: ParamsOf<M>) => ResultOf<M> | Promise<ResultOf<M>>
}

export interface HostConnectionOptions {
  extensionId: string
  endpoint: Endpoint<ToHost, ToExtension>
  handlers: MethodHandlers
  /** Current grants (read on every request: revoking applies at once). */
  granted: () => readonly Permission[]
  /** How long a callback may take before it's abandoned. */
  callbackTimeoutMs?: number
  onLog?: (level: string, message: string) => void
  /** Every request, after the permission check (activity log). */
  onRequest?: (method: HostMethod, allowed: boolean) => void
  /** A callback timed out or the extension misbehaved. */
  onFault?: (reason: string) => void
}

const URL_METHODS = new Set<HostMethod>(["net.fetch", "net.socket"])

export class HostConnection {
  private nextCall = 1
  private calls = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>()
  private subscriptions = new Set<EventName>()
  private stopListening: () => void
  private readyResolve!: () => void
  /** Resolves once the extension's `activate` finished. */
  readonly ready = new Promise<void>((r) => (this.readyResolve = r))
  private closed = false

  constructor(private opts: HostConnectionOptions) {
    this.stopListening = opts.endpoint.listen((m) => this.receive(m))
  }

  activate(info: ActivateInfo): void {
    this.opts.endpoint.post({ t: "activate", info })
  }

  /** Whether the extension asked for `event` (and may receive it). */
  subscribed(event: EventName): boolean {
    return this.subscriptions.has(event)
  }

  emit<E extends EventName>(event: E, payload: HostEvents[E]): void {
    if (this.closed || !this.subscriptions.has(event)) return
    const needs = EVENT_PERMISSIONS[event]
    if (needs && !this.opts.granted().includes(needs)) return
    this.opts.endpoint.post({ t: "event", name: event, payload })
  }

  /** Call one of the extension's callbacks; rejects on error or timeout. */
  call(cbId: number, args: unknown[]): Promise<unknown> {
    if (this.closed) return Promise.reject(new ExtensionError("extension stopped", "cancelled"))
    const id = this.nextCall++
    const timeout = this.opts.callbackTimeoutMs ?? 10_000
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id)
        this.opts.onFault?.(`callback ${cbId} took longer than ${timeout} ms`)
        reject(new ExtensionError("the extension didn't answer in time", "timeout"))
      }, timeout)
      this.calls.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      })
      this.opts.endpoint.post({ t: "call", id, cb: cbId, args })
    })
  }

  /** Turn callback refs inside a value into functions that call the extension. */
  revive<T>(value: T): T {
    if (isCallbackRef(value)) {
      const cbId = value.$cb
      const fn = ((...args: unknown[]) => this.call(cbId, args)) as RemoteFn
      fn.cbId = cbId
      return fn as unknown as T
    }
    if (Array.isArray(value)) return value.map((v) => this.revive(v)) as unknown as T
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) out[k] = this.revive(v)
      return out as T
    }
    return value
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.opts.endpoint.post({ t: "deactivate" })
    this.stopListening()
    for (const c of this.calls.values())
      c.reject(new ExtensionError("extension stopped", "cancelled"))
    this.calls.clear()
  }

  /** Whether `granted` lets the extension call `method` with `params`. */
  static allowed(method: HostMethod, params: unknown, granted: readonly Permission[]): boolean {
    const needs = METHOD_PERMISSIONS[method]
    if (needs === undefined) return false
    if (needs === null) return true
    if (needs === "network") {
      if (!URL_METHODS.has(method)) return granted.some((p) => p.startsWith("network:"))
      const url = (params as { url?: unknown } | null)?.url
      return typeof url === "string" && allowsUrl(granted, url)
    }
    return granted.includes(needs)
  }

  private receive(m: ToHost): void {
    if (this.closed) return
    switch (m.t) {
      case "ready":
        this.readyResolve()
        return
      case "log":
        this.opts.onLog?.(m.level, String(m.message).slice(0, 4000))
        return
      case "ret": {
        const c = this.calls.get(m.id)
        if (!c) return
        this.calls.delete(m.id)
        if (m.ok) c.resolve(this.revive(m.value))
        else c.reject(new ExtensionError(m.error))
        return
      }
      case "req":
        void this.handle(m.id, m.method, m.params)
        return
    }
  }

  private async handle(id: number, method: string, params: unknown): Promise<void> {
    const post = (msg: ToExtension) => {
      if (!this.closed) this.opts.endpoint.post(msg)
    }
    if (!(method in METHOD_PERMISSIONS)) {
      return post({ t: "res", id, ok: false, error: `unknown method ${method}`, code: "invalid" })
    }
    const m = method as HostMethod
    const allowed = HostConnection.allowed(m, params, this.opts.granted())
    this.opts.onRequest?.(m, allowed)
    if (!allowed) {
      const needs = METHOD_PERMISSIONS[m]
      const what = needs === "network" ? "network access to that host" : `"${needs}"`
      return post({
        t: "res",
        id,
        ok: false,
        error: `permission ${what} is needed for ${method}`,
        code: "permission",
      })
    }
    if (m === "self.subscribe" || m === "self.unsubscribe") {
      const event = (params as { event: EventName }).event
      if (!(event in EVENT_PERMISSIONS))
        return post({ t: "res", id, ok: false, error: `unknown event ${event}`, code: "invalid" })
      const needs = EVENT_PERMISSIONS[event]
      if (m === "self.subscribe" && needs && !this.opts.granted().includes(needs))
        return post({
          t: "res",
          id,
          ok: false,
          error: `permission "${needs}" is needed for ${event}`,
          code: "permission",
        })
      if (m === "self.subscribe") this.subscriptions.add(event)
      else this.subscriptions.delete(event)
      return post({ t: "res", id, ok: true, value: undefined })
    }
    const handler = this.opts.handlers[m] as ((p: unknown) => unknown) | undefined
    if (!handler)
      return post({
        t: "res",
        id,
        ok: false,
        error: `${method} isn't available here`,
        code: "notFound",
      })
    try {
      const value = await handler(params)
      post({ t: "res", id, ok: true, value })
    } catch (e) {
      const code = e instanceof ExtensionError ? e.code : "failed"
      post({ t: "res", id, ok: false, error: e instanceof Error ? e.message : String(e), code })
    }
  }
}
