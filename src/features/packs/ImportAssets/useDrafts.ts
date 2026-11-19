import { useState } from "react"
import { type AssetCategory } from "../../../lib/categories"
import { pickImageFiles } from "../api"
import { type Adjust } from "../userAssets"
import { type AdjustTarget } from "../AdjustFields"
import { draftsFor, withCategory, type Draft } from "./drafts"
import { isPreview, type PreviewState } from "./useImportPreviews"

/**
 * The import window's list: the drafts, which ones are being edited
 * together (`checked`) and the one previewed (`focused`), with the edits
 * that apply to the checked ones.
 */
export function useDrafts(files: readonly string[], category: AssetCategory) {
  const [drafts, setDrafts] = useState<Draft[]>(() => draftsFor(files, category))
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(drafts.map((d) => d.key)),
  )
  const [focused, setFocused] = useState<string | null>(drafts[0]?.key ?? null)

  const editing = drafts.filter((d) => checked.has(d.key))
  const focusedDraft = drafts.find((d) => d.key === focused) ?? editing[0] ?? null

  /** Change every draft being edited. */
  const patch = (f: (d: Draft) => Draft) =>
    setDrafts((all) => all.map((d) => (checked.has(d.key) ? f(d) : d)))

  /** Change the adjustments of the ones being edited, each against its own image. */
  const patchAdjust = (
    previews: ReadonlyMap<string, PreviewState>,
    f: (a: Adjust, target: AdjustTarget) => Adjust,
  ) =>
    patch((d) => {
      const p = previews.get(d.source)
      if (!isPreview(p)) return d
      const target = { width: p.width, height: p.height, bounds: p.bounds, adjust: d.adjust }
      return { ...d, adjust: f(d.adjust, target) }
    })

  const addFiles = async (fallback: AssetCategory) => {
    const picked = await pickImageFiles()
    const fresh = draftsFor(picked, editing[0]?.category ?? fallback, drafts)
    if (fresh.length === 0) return
    setDrafts((all) => [...all, ...fresh])
    // The new ones are what's edited next.
    setChecked(new Set(fresh.map((d) => d.key)))
    setFocused(fresh[0].key)
  }

  const setCategory = (next: AssetCategory) => {
    const loose: string[] = []
    const moved = drafts.map((d) => {
      if (!checked.has(d.key)) return d
      const r = withCategory(d, next)
      loose.push(...r.loose)
      return r.draft
    })
    setDrafts([...moved, ...draftsFor(loose, next, moved)])
  }

  const removeChecked = () => {
    const left = drafts.filter((d) => !checked.has(d.key))
    setDrafts(left)
    setChecked(new Set(left.slice(0, 1).map((d) => d.key)))
    setFocused(left[0]?.key ?? null)
  }

  /** A row clicked: edit only it, or add it (Ctrl/Shift). */
  const clickRow = (key: string, additive: boolean) => {
    setFocused(key)
    setChecked(additive ? new Set(checked).add(key) : new Set([key]))
  }

  const toggle = (key: string) => {
    const next = new Set(checked)
    if (next.has(key)) next.delete(key)
    else {
      next.add(key)
      setFocused(key)
    }
    setChecked(next)
  }

  const toggleAll = () =>
    setChecked(checked.size === drafts.length ? new Set() : new Set(drafts.map((d) => d.key)))

  return {
    drafts,
    checked,
    editing,
    focusedDraft,
    patch,
    patchAdjust,
    addFiles,
    setCategory,
    removeChecked,
    clickRow,
    toggle,
    toggleAll,
  }
}
