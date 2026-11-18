import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from "react"
import { useTranslation } from "react-i18next"
import { withLoading } from "../../../stores/loadingStore"
import { getLibraryItems, releaseLibrarySearch, searchLibrary, type LibItem } from "../api"
import { registerLibraryBrowser } from "../browsers"

const PAGE = 200 // items fetched per window request

export interface UseAssetSearchOptions {
  /** Unique per-instance id for the backend result cache (lets several coexist). */
  browserKey: string
  /** Asset category to search (e.g. "objects", "floors", "walls"). */
  category: string
  /** Scope the search to one pack (omit for all enabled packs). */
  packId?: string
  /** Only textures in this pack tag. */
  tag?: string
  /** Only these asset ids (comma-joined key keeps the search stable across renders). */
  onlyIds?: string[]
  /** Whether display slot 0 is the "no asset" cell (shifts real items by one). */
  allowNull: boolean
  /** Selection mode; needed for the single-select default described below. */
  select?: "single" | "multi"
  /** Selected item ids (controlled). */
  selectedIds?: string[]
  onSelectionChange?: (ids: string[], picked?: LibItem) => void
  /** Scroll container of the virtualized grid (reset to top on a new search). */
  scrollRef: RefObject<HTMLDivElement | null>
  /** What the first search looks for (and the box starts with): a suggestion. */
  initialQuery?: string
}

/**
 * Non-visual half of the AssetSelector: paginated search against the backend
 * cache, the visible-window fetching and the sparse item map. Items live in a
 * ref (the map mutates as pages arrive); `tick` bumps to trigger re-renders.
 */
export function useAssetSearch({
  browserKey,
  category,
  packId,
  tag,
  onlyIds,
  allowNull,
  select,
  selectedIds,
  onSelectionChange,
  scrollRef,
  initialQuery = "",
}: UseAssetSearchOptions) {
  const { t } = useTranslation()

  const [queryInput, setQueryInput] = useState(initialQuery)
  // What a fresh search looks for: the suggestion, until the category changes.
  const [freshQuery, setFreshQuery] = useState(initialQuery)
  const [exactness, setExactnessState] = useState(0.5)
  // Latest exactness for runSearch without making it a reactive dependency
  // (moving the slider must not re-trigger the category-change search).
  const exactnessRef = useRef(0.5)
  const setExactness = useCallback((v: number) => {
    exactnessRef.current = v
    setExactnessState(v)
  }, [])

  const [total, setTotal] = useState(0)
  const [searchGen, setSearchGen] = useState(0)
  const items = useRef<Map<number, LibItem>>(new Map())
  const requestedPages = useRef<Set<number>>(new Set())
  const [, bump] = useReducer((x) => x + 1, 0)

  // The null option occupies display slot 0; real items shift up by one.
  const nullOffset = allowNull ? 1 : 0

  // Single-select must always hold one item: when nothing is selected, default
  // to the first result (as if it were clicked). It runs when page 0 of a search arrives (the only
  // moment that can make it possible), not from an effect watching the
  // selection — so it never hands the parent an item from a stale result set
  // (e.g. right after a pack was disabled). Skipped when null is allowed (empty
  // is valid). Page loads resolve asynchronously, so the selection props are
  // read through a ref synced after each commit rather than a stale closure.
  const selectionProps = useRef({ select, allowNull, selectedIds, onSelectionChange })
  useLayoutEffect(() => {
    selectionProps.current = { select, allowNull, selectedIds, onSelectionChange }
  })
  const applyDefaultSelection = useCallback(() => {
    const { select, allowNull, selectedIds, onSelectionChange } = selectionProps.current
    if (select !== "single" || allowNull || !onSelectionChange) return
    if ((selectedIds?.length ?? 0) > 0) return
    const first = items.current.get(0)
    // Passed like a click's pick, so it brings its default color too.
    if (first) onSelectionChange([first.id], first)
  }, [])

  // A primitive key, so a new-but-equal ids array doesn't re-run the search.
  const idsKey = onlyIds ? onlyIds.join("\n") : null

  const runSearch = useCallback(
    (q: string) => {
      items.current.clear()
      requestedPages.current.clear()
      scrollRef.current?.scrollTo({ top: 0 })
      return withLoading(t("loading.searchingLibrary"), () =>
        searchLibrary(browserKey, category, {
          query: q.trim(),
          exactness: exactnessRef.current,
          packId,
          tag,
          ids: idsKey === null ? undefined : idsKey ? idsKey.split("\n") : [],
        }).then((res) => {
          setTotal(res.total)
          setSearchGen((n) => n + 1)
          bump()
        }),
      )
    },
    [browserKey, category, packId, tag, idsKey, t, scrollRef],
  )

  // Reset the query box when the category changes (panel opens/switches),
  // adjusted during render so the stale query never hits the screen.
  const [prevCategory, setPrevCategory] = useState(category)
  if (category !== prevCategory) {
    setPrevCategory(category)
    setQueryInput("")
    setFreshQuery("")
  }

  // Fresh "all" search whenever the category or pack scope changes (runSearch is
  // recreated per category/pack/browser, so it doubles as the trigger).
  // freshQuery only changes along with the category (so with runSearch): one search.
  useEffect(() => {
    void runSearch(freshQuery)
  }, [runSearch, freshQuery])

  // Fetch the pages that cover the currently visible rows. The caller invokes
  // this from an effect fed by the virtualizer's window (rows are display rows,
  // i.e. including the null slot).
  const loadVisibleRows = useCallback(
    (firstRow: number, lastRow: number, cols: number) => {
      if (total === 0) return
      // Map the visible display range back to real item indices (minus the null slot).
      const startIdx = Math.max(0, firstRow * cols - nullOffset)
      const endIdx = Math.min(total, (lastRow + 1) * cols - nullOffset)
      if (endIdx <= startIdx) return
      const firstPage = Math.floor(startIdx / PAGE)
      const lastPage = Math.floor((endIdx - 1) / PAGE)
      for (let p = firstPage; p <= lastPage; p++) {
        if (requestedPages.current.has(p)) continue
        requestedPages.current.add(p)
        getLibraryItems(browserKey, p * PAGE, PAGE)
          .then((batch) => {
            batch.forEach((it, i) => items.current.set(p * PAGE + i, it))
            if (p === 0) applyDefaultSelection()
            bump()
          })
          .catch(() => requestedPages.current.delete(p))
      }
    },
    [browserKey, total, nullOffset, applyDefaultSelection],
  )

  // Ensure every index in [from, to] is loaded (used by shift-range selection).
  const ensureLoaded = useCallback(
    async (from: number, to: number) => {
      const first = Math.floor(from / PAGE)
      const last = Math.floor(to / PAGE)
      const jobs: Promise<void>[] = []
      for (let p = first; p <= last; p++) {
        if (items.current.has(p * PAGE)) continue
        jobs.push(
          getLibraryItems(browserKey, p * PAGE, PAGE).then((batch) => {
            batch.forEach((it, i) => items.current.set(p * PAGE + i, it))
          }),
        )
      }
      if (jobs.length) await Promise.all(jobs)
    },
    [browserKey],
  )

  // Let tools step through this grid's order (Shift+wheel: next asset).
  useEffect(
    () => registerLibraryBrowser(category, { key: browserKey, items: items.current, total }),
    [category, browserKey, total],
  )

  // Release the backend result cache when the browser instance goes away.
  useEffect(() => () => void releaseLibrarySearch(browserKey), [browserKey])

  return {
    /** Sparse index → item map; mutated in place as pages arrive. */
    items,
    total,
    /** Bumped on every new search; retriggers visible-window fetching. */
    searchGen,
    nullOffset,
    queryInput,
    setQueryInput,
    exactness,
    setExactness,
    runSearch,
    loadVisibleRows,
    ensureLoaded,
  }
}
