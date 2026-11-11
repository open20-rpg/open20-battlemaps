import { Texture } from "pixi.js"
import i18n from "../../../i18n"
import { withLoading } from "../../../stores/loadingStore"
import { recolorUrl, thumbUrl } from "../../library/api"
import { resolveAssets, type ResolvedAsset } from "../api"

/**
 * Dungeondraft textures are authored at 256 px per grid tile; every sprite,
 * tiling fill and rope is scaled by this to land in tile units.
 */
export const TEXTURE_PX_PER_TILE = 256

export interface TextureRequest {
  /**
   * Sibling file in the asset's folder to load instead of the main one (e.g.
   * a cave's "wall" next to its "floor", a roof's "edge"/"ridge" next to its
   * "tiles"). The extension is kept from the main file.
   */
  part?: string
  /** Recolor colorable assets to this hex color. */
  color?: string
}

type Listener = () => void

function siblingPath(path: string, part: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  const dot = path.lastIndexOf(".")
  const ext = dot > slash ? path.slice(dot) : ".png"
  return `${path.slice(0, slash + 1)}${part}${ext}`
}

/**
 * Lazy texture cache for placed assets. Entities only store asset ids, so a
 * texture goes through two async steps: resolving the id to a file (batched
 * into one backend call per tick) and loading the image. `texture()` returns
 * undefined until both are done; listeners are notified so the scene redraws
 * the entities that were waiting.
 */
export class AssetCache {
  private resolved = new Map<string, ResolvedAsset | null>()
  private pendingIds = new Set<string>()
  private flushScheduled = false
  private textures = new Map<string, Texture | "loading" | "error">()
  private listeners = new Set<Listener>()
  private notifyScheduled = false

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Texture for an asset id, or undefined while it's resolving/loading (or missing). */
  texture(id: string, req: TextureRequest = {}): Texture | undefined {
    const url = this.urlFor(id, req)
    if (!url) return undefined
    const cached = this.textures.get(url)
    if (cached instanceof Texture) return cached
    if (cached === undefined) this.load(url)
    return undefined
  }

  /** On-map size of an asset's main texture in tiles, once loaded. */
  size(id: string): { w: number; h: number } | undefined {
    const tex = this.texture(id)
    return tex
      ? { w: tex.width / TEXTURE_PX_PER_TILE, h: tex.height / TEXTURE_PX_PER_TILE }
      : undefined
  }

  /** Whether an id is known to be missing (pack/file not installed). */
  isMissing(id: string): boolean {
    return this.resolved.get(id) === null
  }

  /** Register an already-loaded image (data URL, e.g. the reference image). */
  textureFromUrl(url: string): Texture | undefined {
    const cached = this.textures.get(url)
    if (cached instanceof Texture) return cached
    if (cached === undefined) this.load(url)
    return undefined
  }

  private urlFor(id: string, req: TextureRequest): string | undefined {
    const res = this.resolved.get(id)
    if (res === undefined) {
      this.queueResolve(id)
      return undefined
    }
    if (!res?.path) return undefined
    const path = req.part ? siblingPath(res.path, req.part) : res.path
    return res.colorable && req.color ? recolorUrl(path, req.color) : thumbUrl(path)
  }

  private queueResolve(id: string): void {
    if (this.pendingIds.has(id)) return
    this.pendingIds.add(id)
    if (this.flushScheduled) return
    this.flushScheduled = true
    queueMicrotask(() => void this.flushResolve())
  }

  private async flushResolve(): Promise<void> {
    this.flushScheduled = false
    const ids = [...this.pendingIds]
    if (ids.length === 0) return
    try {
      const results = await withLoading(i18n.t("loading.loadingAssets"), () => resolveAssets(ids))
      for (const r of results) this.resolved.set(r.id, r.path ? r : null)
    } catch {
      for (const id of ids) this.resolved.set(id, null)
    } finally {
      for (const id of ids) this.pendingIds.delete(id)
    }
    this.notify()
  }

  private load(url: string): void {
    this.textures.set(url, "loading")
    const img = new Image()
    // Needed so exporting the canvas (PNG) isn't blocked by a tainted canvas.
    img.crossOrigin = "anonymous"
    img.onload = () => {
      this.textures.set(url, Texture.from(img))
      this.notify()
    }
    img.onerror = () => {
      this.textures.set(url, "error")
    }
    img.src = url
  }

  private notify(): void {
    if (this.notifyScheduled) return
    this.notifyScheduled = true
    // Coalesce a burst of loads (a page of objects) into one redraw.
    const nextFrame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb: () => void) => setTimeout(cb, 16)
    nextFrame(() => {
      this.notifyScheduled = false
      for (const l of this.listeners) l()
    })
  }
}

/** The single cache shared by the canvas and the export. */
export const assetCache = new AssetCache()
