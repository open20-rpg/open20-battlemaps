import i18n from "../../i18n"
import { withLoading } from "../../stores/loadingStore"
import { cachedFont, downloadFont, fontFileUrl } from "./api"
import {
  cachedFileName,
  findFamily,
  fontFile,
  fontFileName,
  fontUrl,
  loadCatalog,
  styleName,
  type CatalogFamily,
  type FontChoice,
  type FontFile,
} from "./catalog"

/**
 * Which Google fonts the webview has: a cached .ttf is registered as a
 * FontFace (family + weights + slant), so the edit <input> and the canvas
 * the labels are drawn on use it. A variable font's file is registered once
 * with its whole weight range: every weight of it draws from that one face. Fonts are only downloaded when asked to
 * (picking one, or accepting to fetch a map's missing fonts); anything
 * else just loads what's already on disk. Listeners hear when a font becomes
 * available, so the map redraws the texts that were using the fallback.
 */

type State = "ready" | "loading" | "missing" | "system"
type Listener = () => void

const states = new Map<string, State>()
const listeners = new Set<Listener>()
let notifyScheduled = false

const keyOf = (f: FontChoice) => `${f.family}|${f.weight}|${f.italic ? 1 : 0}`

export function subscribeFonts(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  if (notifyScheduled) return
  notifyScheduled = true
  queueMicrotask(() => {
    notifyScheduled = false
    for (const l of listeners) l()
  })
}

/** Registered files (family + file index): each is added to the page once. */
const registered = new Map<string, Promise<void>>()

/**
 * Register the font file at `path` for its family, weights and slant. A
 * variable file's range lets the browser set its `wght` axis from the
 * weight asked for (a single weight would draw its default instance on
 * some engines).
 */
function register(fam: CatalogFamily, file: FontFile, path: string): Promise<void> {
  const key = `${fam.f}|${file.file}`
  let done = registered.get(key)
  if (!done) {
    const [min, max] = file.weights
    const face = new FontFace(fam.f, `url("${fontFileUrl(path)}")`, {
      weight: min === max ? String(min) : `${min} ${max}`,
      style: file.italic ? "italic" : "normal",
    })
    done = face.load().then(() => {
      document.fonts.add(face)
    })
    done.catch(() => registered.delete(key))
    registered.set(key, done)
  }
  return done
}

/**
 * Make `font` available: system and default fonts already are; a Google
 * one is registered from the cache, or — with `download` — fetched first.
 * Resolves whether it's usable (false: use the fallback).
 */
export async function ensureFont(font: FontChoice, download = false): Promise<boolean> {
  if (!font.family) return true
  const key = keyOf(font)
  const state = states.get(key)
  if (state === "ready" || state === "system") return true
  if (state === "loading") return false
  if (state === "missing" && !download) return false
  // Set before anything async, so a second caller waits for this one.
  states.set(key, "loading")
  const fam = findFamily(await loadCatalog(), font.family)
  if (!fam) {
    states.set(key, "system")
    notify()
    return true
  }
  try {
    const file = fontFile(fam, font.weight, font.italic)
    const fileName = cachedFileName(fam, file)
    // A variable style downloaded before was cached under its style's name.
    let path =
      (await cachedFont(fileName)) ?? (file.variable ? await cachedFont(fontFileName(font)) : null)
    if (!path && download) {
      const style = file.variable
        ? styleName(font.weight, file.italic)
        : styleName(file.weights[0], file.italic)
      path = await withLoading(
        i18n.t("loading.downloadingFont", { font: `${font.family} ${style}` }),
        () => downloadFont(fontUrl(fam, font.weight, font.italic), fileName),
      )
    }
    if (!path) {
      states.set(key, "missing")
      return false
    }
    await register(fam, file, path)
    states.set(key, "ready")
    notify()
    return true
  } catch (err) {
    states.set(key, "missing")
    if (download) throw err
    return false
  }
}

/**
 * Whether texts can draw with `font` now. A Google font not loaded yet
 * starts loading from the cache (never downloads) and answers false until
 * it's in; `pending` tells whether that's still on its way.
 */
export function fontStatus(font: FontChoice): { ready: boolean; pending: boolean } {
  if (!font.family || typeof FontFace === "undefined") return { ready: true, pending: false }
  const state = states.get(keyOf(font))
  if (state === "ready" || state === "system") return { ready: true, pending: false }
  if (state === undefined) {
    void ensureFont(font)
    return { ready: false, pending: true }
  }
  return { ready: false, pending: state === "loading" }
}

/** The Google fonts among `fonts` that aren't downloaded (catalog families only). */
export async function missingFonts(fonts: readonly FontChoice[]): Promise<FontChoice[]> {
  const catalog = await loadCatalog()
  const unique = new Map<string, FontChoice>()
  for (const font of fonts) {
    if (font.family && findFamily(catalog, font.family)) unique.set(keyOf(font), font)
  }
  const candidates = [...unique.values()]
  const usable = await Promise.all(candidates.map((f) => ensureFont(f)))
  return candidates.filter((_, i) => !usable[i])
}
