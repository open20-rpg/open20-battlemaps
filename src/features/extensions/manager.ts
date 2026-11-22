import {
  API_VERSION,
  isPermission,
  localize,
  validateManifest,
  type ActivationEvent,
  type Contribution,
  type ExtensionDefinition,
  type Manifest,
  type Permission,
} from "@open20/battlemaps-sdk"
import { checkFiles, readPackage, type ExtensionPackage } from "@open20/battlemaps-sdk/package"
import { satisfies } from "@open20/battlemaps-sdk/semver"
import {
  scopedKey,
  useExtensionsStore,
  type InstalledExtension,
} from "../../stores/extensionsStore"
import { type ExtensionHost, type ExtensionRuntime } from "./host"
import { type RegistryEntry } from "./services"
import { createInProcessRuntime, createSandboxRuntime } from "./runtime"
import { registerBundledFont } from "./content"

/**
 * Installing, enabling and starting extensions. The registry on disk
 * (services.saveRegistry) remembers what's installed, enabled and granted;
 * the store mirrors it for the UI.
 */

export interface PreparedInstall {
  pkg: ExtensionPackage
  /** The installed version it replaces, if any. */
  previous: Manifest | null
  /** Required permissions the user hasn't granted yet (all of them on a first install). */
  newPermissions: Permission[]
  /** Problems that don't block installing (missing dependencies…). */
  warnings: string[]
}

export type InstallCheck = { ok: true; prepared: PreparedInstall } | { ok: false; errors: string[] }

/** In-process definitions for development and tests, by extension id (no sandbox). */
const builtinDefinitions = new Map<string, ExtensionDefinition>()

export function registerInProcessDefinition(id: string, def: ExtensionDefinition): void {
  builtinDefinitions.set(id, def)
}

export class ExtensionManager {
  constructor(readonly host: ExtensionHost) {}

  private get services() {
    return this.host.services
  }

  /** Read the registry and every installed manifest into the store. */
  async load(): Promise<void> {
    const entries = await this.services.listRegistry()
    const installed: Record<string, InstalledExtension> = {}
    const manifests = await Promise.all(entries.map((e) => this.readManifest(e)))
    entries.forEach((entry, i) => {
      const manifest = manifests[i]
      if (!manifest) return
      installed[manifest.id] = {
        manifest,
        enabled: entry.enabled,
        granted: entry.granted.filter(isPermission),
        settings: entry.settings ?? {},
        dev: !!entry.devPath,
      }
    })
    useExtensionsStore.getState().setInstalled(installed)
  }

  private async readManifest(entry: RegistryEntry): Promise<Manifest | null> {
    try {
      const raw = await this.services.readFile(entry.id, "manifest.json")
      const r = validateManifest(JSON.parse(new TextDecoder().decode(raw)))
      return r.ok && r.manifest.id === entry.id ? r.manifest : null
    } catch {
      return null
    }
  }

  /** Check a package before installing it: what it is and what it asks for. */
  async prepare(bytes: Uint8Array): Promise<InstallCheck> {
    const r = await readPackage(bytes)
    if (!r.ok) return { ok: false, errors: r.issues.map((i) => `${i.path}: ${i.message}`) }
    return this.prepareFiles(r.pkg.files)
  }

  prepareFiles(files: Map<string, Uint8Array>): InstallCheck {
    const r = checkFiles(files)
    if (!r.ok) return { ok: false, errors: r.issues.map((i) => `${i.path}: ${i.message}`) }
    const { manifest } = r.pkg
    if (!satisfies(API_VERSION, manifest.engines.battlemaps))
      return {
        ok: false,
        errors: [`needs app API ${manifest.engines.battlemaps}; this version has ${API_VERSION}`],
      }
    const installed = useExtensionsStore.getState().installed
    const previous = installed[manifest.id]?.manifest ?? null
    const granted = new Set(installed[manifest.id]?.granted ?? [])
    const warnings: string[] = []
    for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
      const d = installed[dep]
      if (!d) warnings.push(`needs extension ${dep} (${range})`)
      else if (!satisfies(d.manifest.version, range))
        warnings.push(`needs ${dep} ${range}, installed ${d.manifest.version}`)
    }
    return {
      ok: true,
      prepared: {
        pkg: r.pkg,
        previous,
        newPermissions: (manifest.permissions ?? []).filter((p) => !granted.has(p)),
        warnings,
      },
    }
  }

  /** Install (or update) a checked package; the user accepted its permissions. */
  async install(prepared: PreparedInstall, opts: { devPath?: string } = {}): Promise<void> {
    const { manifest, files } = prepared.pkg
    const id = manifest.id
    const wasRunning = this.host.isRunning(id)
    this.host.stop(id)
    if (!opts.devPath) await this.services.installFiles(id, files)
    const store = useExtensionsStore.getState()
    const prev = store.installed[id]
    // Grants of permissions the new version no longer declares are dropped.
    const declared = new Set<Permission>([
      ...(manifest.permissions ?? []),
      ...(manifest.optionalPermissions ?? []),
    ])
    const granted = [
      ...new Set([
        ...(prev?.granted ?? []).filter((p) => declared.has(p)),
        ...(manifest.permissions ?? []),
      ]),
    ]
    store.setInstalled({
      ...store.installed,
      [id]: {
        manifest,
        enabled: prev?.enabled ?? true,
        granted,
        settings: prev?.settings ?? {},
        dev: !!opts.devPath,
      },
    })
    if (opts.devPath) devFiles.set(id, files)
    await this.saveRegistry(opts.devPath ? { [id]: opts.devPath } : {})
    if (wasRunning || store.installed[id]?.enabled !== false) await this.start(id)
  }

  async uninstall(id: string): Promise<void> {
    this.host.stop(id)
    this.withdrawData(id)
    const ext = useExtensionsStore.getState().installed[id]
    if (ext && !ext.dev) await this.services.uninstall(id)
    devFiles.delete(id)
    useExtensionsStore.getState().removeInstalled(id)
    await this.saveRegistry()
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    useExtensionsStore.getState().patchInstalled(id, { enabled })
    await this.saveRegistry()
    if (enabled) await this.start(id)
    else {
      this.host.stop(id)
      this.withdrawData(id)
    }
  }

  /** Take back a permission (an optional one, or a required one: then it stops). */
  async revoke(id: string, permission: Permission): Promise<void> {
    const ext = useExtensionsStore.getState().installed[id]
    if (!ext) return
    useExtensionsStore
      .getState()
      .patchInstalled(id, { granted: ext.granted.filter((p) => p !== permission) })
    await this.saveRegistry()
    if ((ext.manifest.permissions ?? []).includes(permission)) {
      this.host.stop(id)
      useExtensionsStore.getState().setStatus(id, "error", `missing permission ${permission}`)
    }
  }

  /** Start every enabled extension whose activation matches `event`. */
  async activate(event: ActivationEvent | "onIdle"): Promise<void> {
    const installed = Object.values(useExtensionsStore.getState().installed)
    const starts = installed.filter(
      (e) => e.enabled && !this.host.isRunning(e.manifest.id) && activatesOn(e.manifest, event),
    )
    await Promise.all(starts.map((e) => this.start(e.manifest.id)))
  }

  /** Register the manifest's data contributions and run its code (if any). */
  async start(id: string): Promise<void> {
    const ext = useExtensionsStore.getState().installed[id]
    if (!ext || !ext.enabled) return
    const granted = new Set(ext.granted)
    const missing = (ext.manifest.permissions ?? []).filter((p) => !granted.has(p))
    if (missing.length) {
      useExtensionsStore
        .getState()
        .setStatus(id, "error", `missing permissions: ${missing.join(", ")}`)
      return
    }
    this.withdrawData(id)
    await this.registerData(ext)
    if (!ext.manifest.main) {
      useExtensionsStore.getState().setStatus(id, "active")
      return
    }
    let runtime: ExtensionRuntime
    const def = builtinDefinitions.get(id)
    if (def) runtime = createInProcessRuntime(def)
    else {
      let code: string
      try {
        code = new TextDecoder().decode(await this.readFile(id, ext.manifest.main))
      } catch (e) {
        useExtensionsStore.getState().setStatus(id, "error", String(e))
        return
      }
      runtime = createSandboxRuntime(code, id)
    }
    await this.host.start(ext, runtime)
  }

  /** Load (or reload) a development extension from its folder. */
  async loadDev(path: string): Promise<string[]> {
    const files = await this.services.readDevFolder(path)
    const check = this.prepareFiles(files)
    if (!check.ok) return check.errors
    await this.install(check.prepared, { devPath: path })
    return []
  }

  /** Read a development extension's folder again and restart it with what's there now. */
  async reloadDev(id: string): Promise<string[]> {
    const entry = (await this.services.listRegistry()).find((e) => e.id === id)
    if (!entry?.devPath) return [`${id} isn't loaded from a folder`]
    return this.loadDev(entry.devPath)
  }

  private readFile(id: string, path: string): Promise<Uint8Array> {
    const dev = devFiles.get(id)?.get(path)
    return dev ? Promise.resolve(dev) : this.services.readFile(id, path)
  }

  private async saveRegistry(devPaths: Record<string, string> = {}): Promise<void> {
    const installed = useExtensionsStore.getState().installed
    const entries = await this.services.listRegistry().catch(() => [] as RegistryEntry[])
    const oldDev = new Map(entries.map((e) => [e.id, e.devPath]))
    await this.services.saveRegistry(
      Object.values(installed).map((e) => ({
        id: e.manifest.id,
        enabled: e.enabled,
        granted: e.granted,
        settings: e.settings,
        ...((devPaths[e.manifest.id] ?? oldDev.get(e.manifest.id))
          ? { devPath: devPaths[e.manifest.id] ?? oldDev.get(e.manifest.id) }
          : {}),
      })),
    )
  }

  /** The manifest's `contributes` (no code involved) as live contributions. */
  private async registerData(ext: InstalledExtension): Promise<void> {
    const id = ext.manifest.id
    const c = ext.manifest.contributes ?? {}
    const store = useExtensionsStore.getState()
    const add = (type: string, cid: string, contribution: Contribution) =>
      store.addContribution({ key: scopedKey(id, `data:${type}:${cid}`), extId: id, contribution })
    const text = async (path: string) => new TextDecoder().decode(await this.readFile(id, path))
    for (const s of c.mapSizes ?? [])
      add("newMapPreset", s.id, {
        type: "newMapPreset",
        id: s.id,
        name: s.name,
        width: s.width,
        height: s.height,
      })
    // Shader sources and fonts are read together (each file on its own).
    const shaders = await Promise.all(
      (c.shaders ?? []).map((sh) =>
        text(sh.path).then(
          (fragment) => ({ sh, fragment }),
          () => ({ sh, fragment: null }),
        ),
      ),
    )
    for (const { sh, fragment } of shaders) {
      if (fragment === null) {
        store.log({ extId: id, kind: "fault", text: `shader ${sh.id}: can't read ${sh.path}` })
        continue
      }
      add("shader", sh.id, {
        type: "shader",
        id: sh.id,
        name: sh.name,
        target: sh.target,
        fragment,
        uniforms: sh.uniforms,
      })
    }
    await Promise.all(
      (c.fonts ?? []).map(async (f) => {
        const bytes = await this.readFile(id, f.path).catch(() => null)
        if (bytes) await registerBundledFont(f.family, bytes, f.style)
      }),
    )
    const [prefabs, languagePacks, keymaps] = await Promise.all([
      loadJsonList(c.prefabs ?? [], text),
      loadJsonList(c.languagePacks ?? [], text),
      loadJsonList(c.keymaps ?? [], text),
    ])
    dataContributions.set(id, {
      toolPresets: c.toolPresets ?? [],
      palettes: c.palettes ?? [],
      postProcessPresets: c.postProcessPresets ?? [],
      lightPresets: c.lightPresets ?? [],
      prefabs,
      templates: c.templates ?? [],
      fonts: c.fonts ?? [],
      languagePacks,
      keymaps,
    })
    useExtensionsStore.setState((s) => ({ rev: s.rev + 1 }))
  }

  private withdrawData(id: string): void {
    const store = useExtensionsStore.getState()
    for (const c of store.contributions)
      if (c.extId === id && c.key.startsWith(scopedKey(id, "data:")))
        store.removeContribution(c.key)
    if (dataContributions.delete(id)) useExtensionsStore.setState((s) => ({ rev: s.rev + 1 }))
  }

  /** A display name for an extension in the user's language. */
  static nameOf(m: Manifest, lang: string): string {
    return localize(m.name, lang)
  }
}

/** Files of development extensions (kept in memory, read from their folder). */
const devFiles = new Map<string, Map<string, Uint8Array>>()

/** Data contributions of each extension (presets, prefabs, language packs…), loaded on start. */
export interface DataContributions {
  toolPresets: NonNullable<NonNullable<Manifest["contributes"]>["toolPresets"]>
  palettes: NonNullable<NonNullable<Manifest["contributes"]>["palettes"]>
  postProcessPresets: NonNullable<NonNullable<Manifest["contributes"]>["postProcessPresets"]>
  lightPresets: NonNullable<NonNullable<Manifest["contributes"]>["lightPresets"]>
  prefabs: { id: string; name: Manifest["name"]; data: unknown }[]
  templates: NonNullable<NonNullable<Manifest["contributes"]>["templates"]>
  fonts: NonNullable<NonNullable<Manifest["contributes"]>["fonts"]>
  languagePacks: { id: string; name: Manifest["name"]; data: unknown; lang?: string }[]
  keymaps: { id: string; name: Manifest["name"]; data: unknown }[]
}

export const dataContributions = new Map<string, DataContributions>()

async function loadJsonList<T extends { path: string; name?: unknown; id?: string; lang?: string }>(
  list: T[],
  read: (path: string) => Promise<string>,
): Promise<{ id: string; name: Manifest["name"]; data: unknown; lang?: string }[]> {
  // A broken file of a data contribution is skipped; the rest still loads.
  const loaded = await Promise.all(
    list.map(async (item) => {
      try {
        return {
          id: item.id ?? item.lang ?? item.path,
          name: (item.name as Manifest["name"]) ?? item.path,
          lang: item.lang,
          data: JSON.parse(await read(item.path)) as unknown,
        }
      } catch {
        return null
      }
    }),
  )
  return loaded.filter((x) => x !== null)
}

/** Whether `event` starts an extension (no activation list: at start). */
export function activatesOn(m: Manifest, event: ActivationEvent | "onIdle"): boolean {
  const events = m.activation ?? ["onStartup"]
  if (event === "onIdle")
    // Tools and commands are offered from the start, so their extensions
    // start once the app is idle after launch (not delaying the launch).
    return events.some((e) => e.startsWith("onTool:") || e.startsWith("onCommand:"))
  return events.includes(event)
}
