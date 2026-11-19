import { ImageSource, Texture } from "pixi.js"
import i18n from "../../../i18n"
import { withLoading } from "../../../stores/loadingStore"
import { recolorUrl, thumbUrl, type RecolorMode } from "../../library/api"
import { resolveAssets, type ResolvedAsset } from "../api"

/**
 * Pack textures (.dungeondraft_pack) are authored at 256 px per grid tile;
 * every sprite, tiling fill and rope is scaled by this to land in tile units.
 */
export const TEXTURE_PX_PER_TILE = 256

export interface TextureRequest {
  /**
   * Sibling file in the asset's folder to load instead of the main one (e.g.
   * a cave's "wall" next to its "floor", a roof's "edge"/"ridge" next to its
   * "tiles"). The extension is kept from the main file.
   */
  part?: string
  /**
   * Suffix appended to the main file's name (keeping folder and extension),
   * e.g. "_end" for a wall's end-cap texture next to it.
   */
  suffix?: string
  /** Recolor colorable assets to this hex color. */
  color?: string
  /** Which red-region recolor (tilesets and patterns use their own). */
  recolorMode?: Exclude<RecolorMode, "tint">
}

type Listener = () => void

/** Path of a related file next to `path`: another name (`part`) and/or a name suffix. */
export function relatedPath(path: string, req: Pick<TextureRequest, "part" | "suffix">): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  const dot = path.lastIndexOf(".")
  const ext = dot > slash ? path.slice(dot) : ".png"
  const stem = path.slice(slash + 1, dot > slash ? dot : undefined)
  return `${path.slice(0, slash + 1)}${req.part ?? stem}${req.suffix ?? ""}${ext}`
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
  /** Alpha channels read back from loaded textures (null: can't be read). */
  private alphas = new Map<string, AlphaMask | null>()
  /** Bumped on every notification (see missingIds). */
  private changes = 0
  /** How textures load (Settings › Performance): fraction of their pixels, mipmaps. */
  private loading: TextureLoading = { scale: 1, mipmaps: false }

  /**
   * Load textures at `scale` of their pixels (same size on the map: fewer
   * texels, less memory and bandwidth) and/or with mipmaps. A change drops
   * every loaded texture: call it only while nothing draws with them (a new
   * canvas). Asset ids stay resolved.
   */
  configure(loading: TextureLoading): void {
    if (loading.scale === this.loading.scale && loading.mipmaps === this.loading.mipmaps) return
    this.loading = loading
    for (const t of this.textures.values()) if (t instanceof Texture) t.destroy(true)
    this.textures.clear()
    this.alphas.clear()
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private missing: { at: number; ids: ReadonlySet<string> } | null = null

  /**
   * Ids known to be missing, as one object that only changes when they do
   * (between notifications): a useSyncExternalStore snapshot.
   */
  missingIds = (): ReadonlySet<string> => {
    if (this.missing?.at === this.changes) return this.missing.ids
    const ids = new Set([...this.resolved].flatMap(([id, r]) => (r === null ? [id] : [])))
    const same = this.missing && sameSet(this.missing.ids, ids)
    this.missing = { at: this.changes, ids: same && this.missing ? this.missing.ids : ids }
    return this.missing.ids
  }

  /** Resolve ids not seen yet (e.g. on other levels, never drawn) so isMissing can tell. */
  prefetch(ids: readonly string[]): void {
    for (const id of ids) if (!this.resolved.has(id)) this.queueResolve(id)
  }

  /** Loaded textures and their GPU memory in MB (mipmaps not counted). Debug stats. */
  stats(): { textures: number; megabytes: number } {
    let textures = 0
    let bytes = 0
    for (const t of this.textures.values()) {
      if (!(t instanceof Texture)) continue
      textures++
      bytes += t.source.pixelWidth * t.source.pixelHeight * 4
    }
    return { textures, megabytes: bytes / 2 ** 20 }
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

  /**
   * Alpha (0–255) of an asset's main texture at (u, v), fractions of its
   * size (0 outside it), or undefined while it isn't loaded (or can't be read back).
   */
  alphaAt(id: string, u: number, v: number): number | undefined {
    const tex = this.texture(id)
    const url = this.urlFor(id, {})
    if (!tex || !url) return undefined
    let mask = this.alphas.get(url)
    if (mask === undefined) {
      mask = readAlpha(tex)
      this.alphas.set(url, mask)
    }
    if (!mask) return undefined
    const ix = Math.floor(u * mask.w)
    const iy = Math.floor(v * mask.h)
    if (ix < 0 || iy < 0 || ix >= mask.w || iy >= mask.h) return 0
    return mask.data[iy * mask.w + ix]
  }

  /**
   * Resolves once every id's main texture has loaded or is known to be
   * unavailable (or after `timeoutMs`, so a stuck load never blocks).
   */
  whenLoaded(ids: readonly string[], timeoutMs = 15000): Promise<void> {
    const settled = () => ids.every((id) => this.texture(id) || this.isUnavailable(id))
    return new Promise((resolve) => {
      if (settled()) return resolve()
      const finish = () => {
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      const unsubscribe = this.subscribe(() => {
        if (settled()) finish()
      })
    })
  }

  /**
   * Whether an asset is recolored by its red regions (Colorable objects,
   * "custom_color" tilesets) rather than tinted. False until resolved.
   */
  isColorable(id: string): boolean {
    return this.resolved.get(id)?.colorable === true
  }

  /** Whether an id is known to be missing (pack/file not installed). */
  isMissing(id: string): boolean {
    return this.resolved.get(id) === null
  }

  /**
   * Whether a texture will never arrive: its asset is missing or the file
   * failed to load (e.g. an optional "_end" cap the pack doesn't ship). The
   * scene stops waiting for those instead of redrawing forever.
   */
  isUnavailable(id: string, req: TextureRequest = {}): boolean {
    if (this.isMissing(id)) return true
    const url = this.urlFor(id, req)
    return !!url && this.textures.get(url) === "error"
  }

  /** Whether an image loaded by URL (textureFromUrl) failed for good. */
  urlFailed(url: string): boolean {
    return this.textures.get(url) === "error"
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
    const path = req.part || req.suffix ? relatedPath(res.path, req) : res.path
    return res.colorable && req.color
      ? recolorUrl(path, req.color, req.recolorMode)
      : thumbUrl(path)
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
      this.textures.set(url, textureOf(img, this.loading))
      this.notify()
    }
    img.onerror = () => {
      this.textures.set(url, "error")
      this.notify()
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
      this.changes++
      for (const l of this.listeners) l()
    })
  }
}

export interface TextureLoading {
  /** Fraction of the image's pixels to keep (1: all). */
  scale: number
  mipmaps: boolean
}

/**
 * A loaded image as a texture. Scaled down, the texture keeps the image's
 * size (its source's resolution is the scale): everything sized from
 * `texture.width`/`height` lands the same, just with fewer texels.
 */
function textureOf(img: HTMLImageElement, { scale, mipmaps }: TextureLoading): Texture {
  if (scale >= 1 && !mipmaps) return Texture.from(img)
  let resource: HTMLImageElement | HTMLCanvasElement = img
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  if (scale < 1 && typeof document !== "undefined") {
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext("2d")
    if (g) {
      g.imageSmoothingQuality = "high"
      g.drawImage(img, 0, 0, w, h)
      resource = canvas
    }
  }
  const resolution = resource === img ? 1 : w / img.naturalWidth
  return new Texture({
    source: new ImageSource({ resource, resolution, autoGenerateMipmaps: mipmaps }),
  })
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id))

interface AlphaMask {
  w: number
  h: number
  data: Uint8Array
}

/** A texture's alpha channel, drawn into a 2D canvas and read back (once per texture). */
function readAlpha(tex: Texture): AlphaMask | null {
  const img = tex.source.resource as CanvasImageSource | undefined
  const w = tex.source.pixelWidth
  const h = tex.source.pixelHeight
  if (!img || typeof document === "undefined" || !w || !h) return null
  try {
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext("2d", { willReadFrequently: true })
    if (!g) return null
    g.drawImage(img, 0, 0)
    const rgba = g.getImageData(0, 0, w, h).data
    const data = new Uint8Array(w * h)
    for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3]
    return { w, h, data }
  } catch {
    // A tainted canvas (cross-origin file): pick by the shape instead.
    return null
  }
}

/** The single cache shared by the canvas and the export. */
export const assetCache = new AssetCache()
