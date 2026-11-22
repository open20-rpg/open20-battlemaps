import i18n from "../../i18n"

/**
 * Data-only content that changes the app: languages and fonts. Kept apart
 * from the manager (which only reads files) so what they touch is explicit.
 */

/** Only string leaves survive (a language pack is translations, nothing else). */
export function cleanTranslations(data: unknown, depth = 0): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data) || depth > 6) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string") out[k] = v.slice(0, 2000)
    else if (v && typeof v === "object") out[k] = cleanTranslations(v, depth + 1)
  }
  return out
}

/** Add a language from an extension and switch to it (missing keys fall back as usual). */
export function applyLanguagePack(lang: string, data: unknown): void {
  if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(lang)) return
  i18n.addResourceBundle(lang, "translation", cleanTranslations(data), true, false)
  const supported = i18n.options.supportedLngs
  if (Array.isArray(supported) && !supported.includes(lang))
    supported.splice(supported.length - 1, 0, lang)
  void i18n.changeLanguage(lang)
}

/** Register an extension's bundled font for drawing text (FontFace in the page). */
export async function registerBundledFont(
  family: string,
  bytes: Uint8Array,
  style = "normal",
): Promise<boolean> {
  if (typeof FontFace === "undefined" || !/^[\w -]{1,80}$/.test(family)) return false
  try {
    const face = new FontFace(family, bytes.slice().buffer as ArrayBuffer, { style })
    await face.load()
    document.fonts.add(face)
    return true
  } catch {
    return false
  }
}
