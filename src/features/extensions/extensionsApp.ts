import i18n from "../../i18n"
import { toaster } from "../../ui/chakra/toaster-instance"
import { useExtensionsStore } from "../../stores/extensionsStore"
import { useMapStore } from "../../stores/mapStore"
import { setExtensionRenderBridge } from "../map/render/extensionRender"
import { renderMapImage } from "../map/render/exportMap"
import { ExtensionHost } from "./host"
import { ExtensionManager } from "./manager"
import { createRenderBridge } from "./renderBridge"
import { tauriServices } from "./tauriServices"
import { syncExtensionTools } from "./tools"
import { startExtensionSnap } from "./snap"
import { installDocumentHooks } from "./documents"

/**
 * The app's extension host and manager (one each), wired to the platform,
 * the renderer and the tool palette. `startExtensions` runs once at launch.
 */
export const extensionHost = new ExtensionHost(tauriServices)
export const extensionManager = new ExtensionManager(extensionHost)

extensionHost.hooks = {
  appVersion: __APP_VERSION__,
  storeBuild: __STORE_BUILD__,
  language: () => i18n.language || "es",
  viewportSize: () => {
    const el = document.querySelector("canvas")
    return el ? { w: el.clientWidth, h: el.clientHeight } : { w: 1200, h: 800 }
  },
  renderToImage: async (opts) => {
    const bytes = await renderMapImage(opts)
    if (!bytes) throw new Error("no map is open")
    return bytes
  },
  notify: (extId, message, tone, action) =>
    new Promise<boolean>((resolve) => {
      const name = useExtensionsStore.getState().installed[extId]?.manifest
      const type =
        tone === "error"
          ? "error"
          : tone === "warning"
            ? "warning"
            : tone === "success"
              ? "success"
              : "info"
      let clicked = false
      toaster.create({
        title: name
          ? typeof name.name === "string"
            ? name.name
            : (name.name[i18n.language] ?? name.name.es)
          : extId,
        description: message,
        type,
        ...(action
          ? {
              action: {
                label: action,
                onClick: () => {
                  clicked = true
                  resolve(true)
                },
              },
            }
          : {}),
        onStatusChange: (d: { status: string }) => {
          if (d.status === "unmounted" && !clicked) resolve(false)
        },
      })
    }),
  theme: () => {
    const css = getComputedStyle(document.documentElement)
    const tokens: Record<string, string> = {}
    for (const name of [
      "--chakra-colors-panel-bg",
      "--chakra-colors-fg",
      "--chakra-colors-fg-muted",
      "--chakra-colors-brand-solid",
      "--chakra-colors-panel-border",
    ])
      tokens[name.replace("--chakra-colors-", "")] = css.getPropertyValue(name).trim()
    const dark =
      document.documentElement.classList.contains("dark") ||
      !document.documentElement.classList.contains("light")
    return { mode: dark ? "dark" : "light", tokens }
  },
}

setExtensionRenderBridge(createRenderBridge(tauriServices))

let started = false

/** Load the installed extensions and start them by their activation events. */
export function startExtensions(): () => void {
  if (started) return () => {}
  started = true
  // The palette and properties follow what's contributed.
  const unsubTools = useExtensionsStore.subscribe((s, prev) => {
    if (s.contributions !== prev.contributions) syncExtensionTools(s.contributions)
  })
  const stopSnap = startExtensionSnap()
  const stopDocuments = installDocumentHooks()
  const unsubMap = useMapStore.subscribe((s, prev) => {
    if (s.map && !prev.map) void extensionManager.activate("onMapOpen")
  })
  void (async () => {
    try {
      await extensionManager.load()
      await extensionManager.activate("onStartup")
      // Tools and commands: once the app is idle, so launching isn't slower.
      const idle = (cb: () => void) =>
        "requestIdleCallback" in window
          ? window.requestIdleCallback(cb, { timeout: 4000 })
          : setTimeout(cb, 1500)
      idle(() => void extensionManager.activate("onIdle"))
      if (useMapStore.getState().map) await extensionManager.activate("onMapOpen")
    } catch {
      // Without a native side (plain browser) there are no extensions.
    }
  })()
  return () => {
    unsubTools()
    unsubMap()
    stopSnap()
    stopDocuments()
    extensionHost.stopAll()
    started = false
  }
}
