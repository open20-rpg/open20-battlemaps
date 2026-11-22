import { type AssetInfo, type FileData } from "@open20/battlemaps-sdk"
import { withLoading } from "../../stores/loadingStore"
import i18n from "../../i18n"
import { getLibraryItems, releaseLibrarySearch, searchLibrary, thumbUrl } from "../library/api"
import { resolveAssets } from "../map/api"
import {
  createUserPack,
  editUserAsset,
  importUserAssets,
  listInstalled,
  type ImportItem,
  userAssetInfo,
} from "../packs/api"
import { NO_ADJUST } from "../packs/userAssets"
import { ensureFont } from "../fonts/registry"
import { DEFAULT_FONT } from "../fonts/catalog"
import {
  extensionFetch,
  folderList,
  folderRead,
  folderWrite,
  installExtensionFiles,
  openExtensionUrl,
  pickFilePaths,
  pickFolderPath,
  pickSavePath,
  readDevFolder,
  readExtensionFile,
  readPickedFile,
  readRegistry,
  saveRegistry,
  storageDelete,
  storageGet,
  storageKeys,
  storageSet,
  uninstallExtension,
  writePickedFile,
  writeTempFile,
} from "./api"
import { type HostServices } from "./services"

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

const mimeOf = (name: string) => {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  return (
    {
      png: "image/png",
      webp: "image/webp",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      json: "application/json",
      txt: "text/plain",
    }[ext] ?? "application/octet-stream"
  )
}

let searchSeq = 0

/**
 * The host's platform services in the app: Tauri commands, the native
 * dialogs, the Library and the packs. Every user-facing slow operation is
 * wrapped in `withLoading` so it shows in the status bar.
 */
export const tauriServices: HostServices = {
  listRegistry: () => readRegistry(),
  saveRegistry: (entries) => saveRegistry(entries),
  installFiles: (id, files) =>
    withLoading(i18n.t("extensions.loading.installing"), () => installExtensionFiles(id, files)),
  uninstall: (id) => uninstallExtension(id),
  readFile: (id, path) => readExtensionFile(id, path),
  readDevFolder: (path) =>
    withLoading(i18n.t("extensions.loading.reading"), () => readDevFolder(path)),
  pickPackage: async () => {
    const [path] = await pickFilePaths(["otbx"], false)
    if (!path) return null
    const bytes = await withLoading(i18n.t("extensions.loading.reading"), () =>
      readPickedFile(path),
    )
    return { name: baseName(path), bytes, mime: "application/zip" }
  },
  pickDevFolder: () => pickFolderPath(),
  storageGet: (id, key) => storageGet(id, key),
  storageSet: (id, key, value) => storageSet(id, key, value),
  storageDelete: (id, key) => storageDelete(id, key),
  storageKeys: (id) => storageKeys(id),
  fetch: (req) => extensionFetch(req),
  openSocket: (url, onMessage, onClose) => {
    const ws = new WebSocket(url)
    ws.onmessage = (e) => onMessage(typeof e.data === "string" ? e.data : "")
    ws.onclose = () => onClose()
    ws.onerror = () => ws.close()
    return {
      send: (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data)
      },
      close: () => ws.close(),
    }
  },
  pickFiles: async (extensions, multiple) => {
    const paths = await pickFilePaths(extensions, multiple)
    return withLoading(i18n.t("extensions.loading.reading"), () =>
      Promise.all(
        paths.map(async (p): Promise<FileData> => {
          const name = baseName(p)
          return { name, bytes: await readPickedFile(p), mime: mimeOf(name) }
        }),
      ),
    )
  },
  saveFile: async (file) => {
    const path = await pickSavePath(file.name)
    if (!path) return false
    await withLoading(i18n.t("extensions.loading.saving"), () => writePickedFile(path, file.bytes))
    return true
  },
  pickFolder: () => pickFolderPath(),
  folderList: (root, path) => folderList(root, path),
  folderRead: (root, path) => folderRead(root, path),
  folderWrite: (root, path, bytes) => folderWrite(root, path, bytes),
  clipboardWriteText: (text) => navigator.clipboard.writeText(text),
  clipboardReadText: () => navigator.clipboard.readText(),
  clipboardWriteImage: async (image) => {
    const type = image.mime ?? "image/png"
    await navigator.clipboard.write([
      new ClipboardItem({ [type]: new Blob([image.bytes as BlobPart], { type }) }),
    ])
  },
  openUrl: (url) => openExtensionUrl(url),
  libraryPacks: async () =>
    (await listInstalled()).map((p) => ({
      id: p.id,
      name: p.name,
      author: p.author ?? "",
      version: p.version ?? "",
      editable: p.editable,
      enabled: p.enabled,
    })),
  librarySearch: async (q) => {
    const key = `ext-search-${++searchSeq}`
    const category = q.category ?? "objects"
    const limit = Math.min(q.limit ?? 100, 500)
    try {
      await searchLibrary(key, category, {
        query: q.query ?? "",
        ...(q.packs?.length === 1 ? { packId: q.packs[0] } : {}),
        ...(q.tags?.length ? { tag: q.tags[0] } : {}),
      })
      const items = await getLibraryItems(key, 0, limit)
      const packs = q.packs && new Set(q.packs)
      return items
        .filter((i) => !packs || packs.has(i.id.split("|")[0]))
        .map((i): AssetInfo => ({
          id: i.id,
          name: i.name,
          category,
          pack: i.id.split("|")[0],
          tags: q.tags ?? [],
          colorable: i.colorable,
          thumbnail: thumbUrl(i.thumb),
        }))
    } finally {
      void releaseLibrarySearch(key)
    }
  },
  libraryAsset: async (id) => {
    const [resolved] = await resolveAssets([id])
    if (!resolved?.path) return null
    return {
      id,
      name: baseName(resolved.path).replace(/\.[^.]+$/, ""),
      category: id.split("|")[1]?.split("/")[1] ?? "",
      pack: id.split("|")[0],
      tags: [],
      colorable: resolved.colorable,
    }
  },
  libraryImage: async (id) => {
    const [resolved] = await resolveAssets([id])
    if (!resolved?.path) return null
    const name = baseName(resolved.path)
    return { name, bytes: await readPickedFile(resolved.path), mime: mimeOf(name) }
  },
  createPack: async (name, author) =>
    (await createUserPack({ name, author, version: "1.0.0", keywords: [] })).id,
  importImages: async (pack, files, category) => {
    // Temporary files are grouped per pack under a valid-looking id.
    const folder = `import.${pack.toLowerCase().replace(/[^a-z0-9-]/g, "") || "pack"}`
    const items: ImportItem[] = await Promise.all(
      files.map(async (f) => ({
        source: await writeTempFile(folder, baseName(f.name), f.bytes),
        category,
        name: baseName(f.name).replace(/\.[^.]+$/, ""),
        folder: "",
        parts: {},
        adjust: NO_ADJUST,
        colorable: false,
        tags: [],
        color: null,
      })),
    )
    const report = await withLoading(i18n.t("extensions.loading.importing"), () =>
      importUserAssets(pack, items, "balanced"),
    )
    return report.imported
  },
  setAssetTags: async (asset, tags) => {
    await editUserAsset(asset, { tags })
  },
  setAssetMetadata: async (asset) => {
    // Asset metadata of extensions is kept by the extension (storage) until
    // packs have a field for it; checking the asset exists is enough here.
    await userAssetInfo(asset)
  },
  loadFont: (family) => ensureFont({ ...DEFAULT_FONT, family }, true),
}
