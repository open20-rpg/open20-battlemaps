import {
  endpointPair,
  type Endpoint,
  type ToExtension,
  type ToHost,
} from "@open20/battlemaps-sdk/protocol"
import { runExtension, type ExtensionDefinition } from "@open20/battlemaps-sdk"
import { type ExtensionRuntime } from "./host"

/**
 * Where extension code runs.
 *
 * In the app, each extension gets a hidden `<iframe sandbox="allow-scripts">`
 * (an opaque origin: no cookies, storage, parent DOM or Tauri IPC) with a
 * strict CSP (no network, no eval), and its code runs in a Worker created
 * inside that frame (it inherits the CSP and has no DOM at all). Before the
 * code runs, a prelude removes every network and storage API from the
 * worker. The only way out is the MessagePort the host holds the other end
 * of — and the host checks every request against the extension's grants.
 */

/** What the frame allows: scripts from itself and blobs, WASM; nothing else at all. */
export const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob: 'wasm-unsafe-eval'",
  "worker-src blob:",
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ")

/**
 * Runs first in the worker: removes the ways out (network, storage, other
 * contexts) from the global scope and its prototypes, then gives the SDK
 * its endpoint, buffering messages until the host's port arrives.
 */
export const WORKER_PRELUDE = `"use strict";
(() => {
  const g = self;
  const banned = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport",
    "importScripts", "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker",
    "Request", "Response", "Headers", "FileReaderSync", "CacheStorage", "IDBFactory",
    "Notification", "ServiceWorker", "RTCPeerConnection", "webkitRTCPeerConnection"];
  for (const name of banned) {
    let o = g;
    while (o) {
      try { if (Object.getOwnPropertyDescriptor(o, name)) delete o[name]; } catch (e) {}
      try { if (name in o) Object.defineProperty(o, name, { value: undefined, configurable: false, writable: false }); } catch (e) {}
      o = Object.getPrototypeOf(o);
    }
  }
  try { Object.defineProperty(g.navigator, "storage", { value: undefined }); } catch (e) {}
  try { Object.defineProperty(g.navigator, "serviceWorker", { value: undefined }); } catch (e) {}
  let port = null;
  const queue = [];
  const handlers = new Set();
  const endpoint = {
    post(m, t) { if (port) port.postMessage(m, t || []); else queue.push([m, t]); },
    listen(h) { handlers.add(h); return () => handlers.delete(h); },
  };
  const onFirst = (ev) => {
    if (!ev.data || ev.data.t !== "__port" || port) return;
    port = ev.data.port;
    port.onmessage = (e) => { for (const h of handlers) h(e.data); };
    for (const [m, t] of queue.splice(0)) port.postMessage(m, t || []);
    g.removeEventListener("message", onFirst);
  };
  g.addEventListener("message", onFirst);
  Object.defineProperty(g, "__open20Endpoint", { value: endpoint });
  const origPost = g.postMessage.bind(g);
  Object.defineProperty(g, "postMessage", { value: () => {} });
  void origPost;
})();
var module = { exports: {} }; var exports = module.exports;
var require = function (name) { throw new Error("require(" + name + "): bundle your dependencies"); };
`

/** The frame's page: waits for the code and the port from its parent, starts the worker. */
export function sandboxDocument(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
</head><body><script>
"use strict";
window.addEventListener("message", (ev) => {
  if (ev.source !== window.parent || !ev.data || ev.data.t !== "__start") return;
  const { code, prelude } = ev.data;
  const port = ev.ports[0];
  const url = URL.createObjectURL(new Blob([prelude, "\\n;", code], { type: "text/javascript" }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  worker.onerror = (e) => port.postMessage({ t: "log", level: "error", message: "worker error: " + (e.message || "") });
  worker.postMessage({ t: "__port", port }, [port]);
}, { once: true });
</script></body></html>`
}

/** Run extension code in a sandboxed frame + worker (the app's runtime). */
export function createSandboxRuntime(code: string, extId: string): ExtensionRuntime {
  const frame = document.createElement("iframe")
  frame.setAttribute("sandbox", "allow-scripts")
  frame.setAttribute("aria-hidden", "true")
  frame.setAttribute("tabindex", "-1")
  frame.dataset.extension = extId
  frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden"
  frame.srcdoc = sandboxDocument()
  const channel = new MessageChannel()
  const handlers = new Set<(m: ToHost) => void>()
  channel.port1.onmessage = (e) => {
    for (const h of handlers) h(e.data as ToHost)
  }
  const endpoint: Endpoint<ToHost, ToExtension> = {
    post: (m, transfer) => channel.port1.postMessage(m, transfer ?? []),
    listen: (h) => (handlers.add(h), () => handlers.delete(h)),
  }
  frame.addEventListener(
    "load",
    () => {
      frame.contentWindow?.postMessage({ t: "__start", code, prelude: WORKER_PRELUDE }, "*", [
        channel.port2,
      ])
    },
    { once: true },
  )
  document.body.appendChild(frame)
  return {
    endpoint,
    terminate: () => {
      channel.port1.close()
      frame.remove()
    },
  }
}

/** Run an extension definition in this thread (tests, and the SDK's examples). */
export function createInProcessRuntime(def: ExtensionDefinition): ExtensionRuntime {
  const [hostEnd, extEnd] = endpointPair<ToHost, ToExtension>()
  const run = runExtension(def, extEnd)
  return { endpoint: hostEnd, terminate: () => run.stop() }
}
