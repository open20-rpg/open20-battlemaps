import {
  API_VERSION,
  type ExtensionDefinition,
  type Manifest,
  type Permission,
} from "@open20/battlemaps-sdk"
import { useExtensionsStore } from "../../stores/extensionsStore"
import { createMap } from "../map/commands"
import { ExtensionHost } from "./host"
import { createInProcessRuntime } from "./runtime"
import { createTestServices, type TestServices } from "./testServices"

/**
 * Runs extensions against the real host and the app's real stores (no
 * sandbox, no Tauri): what the extension tests use to check that each
 * capability does what it says in the app itself.
 */
export interface Harness {
  host: ExtensionHost
  services: TestServices
  start(
    def: ExtensionDefinition,
    manifest: Partial<Manifest> & { permissions?: Permission[] },
  ): Promise<string>
  /** Let pending messages and callbacks run. */
  flush(): Promise<void>
  /** Answer the next prompt the extension opened. */
  answer(value: unknown): Promise<void>
  stop(): void
}

export function createHarness(
  opts: { map?: { width: number; height: number } | null } = {},
): Harness {
  const services = createTestServices()
  const host = new ExtensionHost(services)
  host.hooks = {
    appVersion: "0.0.0-test",
    language: () => "es",
    notify: async (extId, message) => {
      useExtensionsStore.getState().log({ extId, kind: "log", text: `notify: ${message}` })
      return false
    },
    renderToImage: async () => new Uint8Array([137, 80, 78, 71]),
  }
  useExtensionsStore.setState({
    installed: {},
    status: {},
    contributions: [],
    overlays: {},
    draft: [],
    panels: {},
    statusItems: {},
    particles: {},
    progress: [],
    prompts: [],
    activity: [],
    tour: null,
    cursor: null,
  })
  if (opts.map !== null) createMap(opts.map?.width ?? 20, opts.map?.height ?? 20)
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
  }
  return {
    host,
    services,
    flush,
    start: async (def, manifest) => {
      const full: Manifest = {
        manifestVersion: 1,
        id: "test.ext",
        name: "Test",
        version: "1.0.0",
        author: { name: "test" },
        engines: { battlemaps: `^${API_VERSION}` },
        main: "main.js",
        ...manifest,
      }
      useExtensionsStore.setState((s) => ({
        installed: {
          ...s.installed,
          [full.id]: {
            manifest: full,
            enabled: true,
            granted: full.permissions ?? [],
            settings: {},
            dev: false,
          },
        },
      }))
      await host.start(
        useExtensionsStore.getState().installed[full.id],
        createInProcessRuntime(def),
      )
      await flush()
      return full.id
    },
    answer: async (value) => {
      await flush()
      const prompt = useExtensionsStore.getState().prompts[0]
      if (!prompt) throw new Error("no prompt is open")
      host.answerPrompt(prompt.id, value)
      await flush()
    },
    stop: () => host.stopAll(),
  }
}
