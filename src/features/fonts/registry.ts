import i18n from "../../i18n"
import { withLoading } from "../../stores/loadingStore"
import { cachedFont, downloadFont, fontFileUrl } from "./api"
import {
  findFamily,
  fontFileName,
  fontUrl,
  loadCatalog,
  nearestStyle,
  styleName,
  type FontChoice,
} from "./catalog"

/**
 * Which Google fonts the webview has: a cached .ttf is registered as a
 * FontFace (family + weight + slant), so the edit <input>, canvas measuring
 * and the SDF atlases all use it. Fonts are only downloaded when asked to
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

/** Register the font file at `path` for `font`'s family, weight and slant. */
async function register(font: FontChoice, path: string): Promise<void> {
  const face = new FontFace(font.family, `url("${fontFileUrl(path)}")`, {
    weight: String(font.weight),
    style: font.italic ? "italic" : "normal",
  })
  await face.load()
  document.fonts.add(face)
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
    const fileName = fontFileName(font)
    let path = await cachedFont(fileName)
    if (!path && download) {
      const [weight, italic] = nearestStyle(fam, font.weight, font.italic)
      path = await withLoading(
        i18n.t("loading.downloadingFont", {
          font: `${font.family} ${styleName(weight, !!italic)}`,
        }),
        () => downloadFont(fontUrl(fam, font.weight, font.italic), fileName),
      )
    }
    if (!path) {
      states.set(key, "missing")
      return false
    }
    await register(font, path)
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
