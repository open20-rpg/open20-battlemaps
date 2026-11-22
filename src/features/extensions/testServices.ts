import { type FileData } from "@open20/battlemaps-sdk"
import { type HostServices, type RegistryEntry } from "./services"

/**
 * In-memory platform services for tests (and the examples' tests): files,
 * registry and storage live in maps; dialogs answer from `answers`.
 */
export interface TestServices extends HostServices {
  registry: RegistryEntry[]
  files: Map<string, Map<string, Uint8Array>>
  storage: Map<string, Map<string, unknown>>
  fetched: string[]
  saved: FileData[]
  clipboard: string
  opened: string[]
  folder: Map<string, Uint8Array>
  pickResult: FileData[]
}

export function createTestServices(): TestServices {
  const s: TestServices = {
    registry: [],
    files: new Map(),
    storage: new Map(),
    fetched: [],
    saved: [],
    clipboard: "",
    opened: [],
    folder: new Map(),
    pickResult: [],
    listRegistry: async () => structuredClone(s.registry),
    saveRegistry: async (entries) => {
      s.registry = structuredClone(entries)
    },
    installFiles: async (id, files) => {
      s.files.set(id, new Map(files))
    },
    uninstall: async (id) => {
      s.files.delete(id)
      s.storage.delete(id)
    },
    readFile: async (id, path) => {
      const f = s.files.get(id)?.get(path)
      if (!f) throw new Error(`no file ${path}`)
      return f
    },
    readDevFolder: async () => new Map(),
    pickPackage: async () => null,
    pickDevFolder: async () => null,
    storageGet: async (id, key) => structuredClone(s.storage.get(id)?.get(key)),
    storageSet: async (id, key, value) => {
      if (!s.storage.has(id)) s.storage.set(id, new Map())
      s.storage.get(id)!.set(key, structuredClone(value))
    },
    storageDelete: async (id, key) => {
      s.storage.get(id)?.delete(key)
    },
    storageKeys: async (id) => [...(s.storage.get(id)?.keys() ?? [])],
    fetch: async (req) => {
      s.fetched.push(req.url)
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode('{"ok":true}'),
      }
    },
    openSocket: (_url, onMessage, onClose) => ({
      send: (data) => onMessage(`echo:${data}`),
      close: onClose,
    }),
    pickFiles: async () => s.pickResult,
    saveFile: async (file) => {
      s.saved.push(file)
      return true
    },
    pickFolder: async () => "/tmp/carpeta",
    folderList: async () =>
      [...s.folder.entries()].map(([name, bytes]) => ({ name, dir: false, size: bytes.length })),
    folderRead: async (_root, path) => {
      const f = s.folder.get(path)
      if (!f) throw new Error(`no file ${path}`)
      return f
    },
    folderWrite: async (_root, path, bytes) => {
      s.folder.set(path, bytes)
    },
    clipboardWriteText: async (text) => {
      s.clipboard = text
    },
    clipboardReadText: async () => s.clipboard,
    clipboardWriteImage: async () => {},
    openUrl: async (url) => {
      s.opened.push(url)
    },
    libraryPacks: async () => [
      { id: "pack1", name: "Pack", author: "A", version: "1", editable: true, enabled: true },
    ],
    librarySearch: async (q) =>
      [
        {
          id: "pack1|textures/objects/barrel.png",
          name: "barrel",
          category: "objects",
          pack: "pack1",
          tags: ["wood"],
          colorable: false,
        },
        {
          id: "pack1|textures/objects/torch.png",
          name: "torch",
          category: "objects",
          pack: "pack1",
          tags: ["light"],
          colorable: false,
        },
      ].filter((a) => !q.query || a.name.includes(q.query)),
    libraryAsset: async (id) => ({
      id,
      name: id,
      category: "objects",
      pack: "pack1",
      tags: [],
      colorable: false,
    }),
    libraryImage: async () => ({ name: "a.png", bytes: new Uint8Array([1]), mime: "image/png" }),
    createPack: async (name) => `user-${name}`,
    importImages: async (pack, files) => files.map((f) => `${pack}|${f.name}`),
    setAssetTags: async () => {},
    setAssetMetadata: async () => {},
    loadFont: async () => true,
  }
  return s
}
