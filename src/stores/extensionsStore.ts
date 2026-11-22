import { useMemo } from "react"
import { create } from "zustand"
import {
  type Contribution,
  type ContributionType,
  type Manifest,
  type ParticleEmitter,
  type Permission,
  type Primitive,
  type UiNode,
} from "@open20/battlemaps-sdk"

/** An installed extension as the registry keeps it (see features/extensions). */
export interface InstalledExtension {
  manifest: Manifest
  enabled: boolean
  /** Permissions the user granted (required ones on install, optional ones when asked). */
  granted: Permission[]
  settings: Record<string, unknown>
  /** Loaded from a folder in development mode (reloads on demand). */
  dev: boolean
}

export type RuntimeStatus = "inactive" | "starting" | "active" | "error"

/** A contribution live in the app, with its callbacks ready to call. */
export interface LiveContribution<C extends Contribution = Contribution> {
  key: string
  extId: string
  contribution: C
}

export interface ActivityEntry {
  time: number
  extId: string
  kind: "request" | "denied" | "fault" | "log" | "change"
  text: string
}

/** A question an extension asked that waits for the user (rendered by ExtensionPrompts). */
export type PendingPrompt =
  | { id: string; extId: string; kind: "confirm"; title: string; message: string; danger?: boolean }
  | { id: string; extId: string; kind: "prompt"; title: string; label: string; value: string }
  | {
      id: string
      extId: string
      kind: "choose"
      title: string
      options: { id: string; label: string }[]
    }
  | { id: string; extId: string; kind: "permission"; permission: Permission }
  | { id: string; extId: string; kind: "openUrl"; url: string }

export interface ProgressTask {
  id: string
  extId: string
  title: string
  value: number | null
  message?: string
}

const ACTIVITY_LIMIT = 500

/**
 * Extensions: what's installed, what each one runs and contributes, and
 * the session state they draw (overlays, panels, status items). Session
 * state only — the registry on disk is the source of truth for installs
 * (see features/extensions/manager.ts). Outside undo/redo: extensions
 * change the map only through commands.
 */
interface ExtensionsState {
  installed: Record<string, InstalledExtension>
  status: Record<string, { status: RuntimeStatus; error?: string }>
  contributions: LiveContribution[]
  /** Bumped on every contribution change (consumers recompute what they derive). */
  rev: number
  overlays: Record<string, { extId: string; primitives: Primitive[]; level?: string }>
  /** What the active extension tool draws while used. */
  draft: Primitive[]
  panels: Record<string, { open: boolean; ui: UiNode | null }>
  statusItems: Record<string, { text: string; tooltip?: string }>
  particles: Record<string, ParticleEmitter[]>
  progress: ProgressTask[]
  prompts: PendingPrompt[]
  activity: ActivityEntry[]
  /** The tour being shown, if any. */
  tour: { key: string; step: number } | null
  /** CSS cursor an extension asked for over the map (null: the tool's own). */
  cursor: string | null
  setCursor: (cursor: string | null) => void
  setInstalled: (installed: Record<string, InstalledExtension>) => void
  patchInstalled: (id: string, patch: Partial<InstalledExtension>) => void
  removeInstalled: (id: string) => void
  setStatus: (id: string, status: RuntimeStatus, error?: string) => void
  addContribution: (c: LiveContribution) => void
  removeContribution: (key: string) => void
  /** Drop everything an extension contributed or drew (it stopped). */
  dropExtension: (extId: string) => void
  setOverlay: (key: string, value: ExtensionsState["overlays"][string] | null) => void
  setDraft: (draft: Primitive[]) => void
  setPanel: (key: string, patch: Partial<{ open: boolean; ui: UiNode | null }>) => void
  setStatusItem: (key: string, value: { text: string; tooltip?: string } | null) => void
  setParticles: (key: string, emitters: ParticleEmitter[] | null) => void
  setProgress: (task: ProgressTask | null, id?: string) => void
  pushPrompt: (prompt: PendingPrompt) => void
  dropPrompt: (id: string) => void
  log: (entry: Omit<ActivityEntry, "time">) => void
  setTour: (tour: { key: string; step: number } | null) => void
}

const ownedBy = (extId: string) => (key: string) => key.startsWith(`${extId}::`)

const without = <T>(record: Record<string, T>, keep: (key: string) => boolean): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => keep(k)))

export const useExtensionsStore = create<ExtensionsState>()((set) => ({
  installed: {},
  status: {},
  contributions: [],
  rev: 0,
  overlays: {},
  draft: [],
  panels: {},
  statusItems: {},
  particles: {},
  progress: [],
  prompts: [],
  activity: [],
  tour: null,
  cursor: null,
  setCursor: (cursor) => set({ cursor }),
  setInstalled: (installed) => set({ installed }),
  patchInstalled: (id, patch) =>
    set((s) =>
      s.installed[id]
        ? { installed: { ...s.installed, [id]: { ...s.installed[id], ...patch } } }
        : s,
    ),
  removeInstalled: (id) =>
    set((s) => ({
      installed: without(s.installed, (k) => k !== id),
      status: without(s.status, (k) => k !== id),
    })),
  setStatus: (id, status, error) =>
    set((s) => ({ status: { ...s.status, [id]: { status, error } } })),
  addContribution: (c) => set((s) => ({ contributions: [...s.contributions, c], rev: s.rev + 1 })),
  removeContribution: (key) =>
    set((s) => ({ contributions: s.contributions.filter((c) => c.key !== key), rev: s.rev + 1 })),
  dropExtension: (extId) =>
    set((s) => {
      const mine = ownedBy(extId)
      const keep = (k: string) => !mine(k)
      return {
        contributions: s.contributions.filter((c) => c.extId !== extId),
        rev: s.rev + 1,
        overlays: without(s.overlays, keep),
        panels: without(s.panels, keep),
        statusItems: without(s.statusItems, keep),
        particles: without(s.particles, keep),
        progress: s.progress.filter((p) => p.extId !== extId),
        prompts: s.prompts.filter((p) => p.extId !== extId),
        tour: s.tour && mine(s.tour.key) ? null : s.tour,
      }
    }),
  setOverlay: (key, value) =>
    set((s) => ({
      overlays: value ? { ...s.overlays, [key]: value } : without(s.overlays, (k) => k !== key),
    })),
  setDraft: (draft) => set({ draft }),
  setPanel: (key, patch) =>
    set((s) => ({
      panels: { ...s.panels, [key]: { ...(s.panels[key] ?? { open: false, ui: null }), ...patch } },
    })),
  setStatusItem: (key, value) =>
    set((s) => ({
      statusItems: value
        ? { ...s.statusItems, [key]: value }
        : without(s.statusItems, (k) => k !== key),
    })),
  setParticles: (key, emitters) =>
    set((s) => ({
      particles: emitters
        ? { ...s.particles, [key]: emitters }
        : without(s.particles, (k) => k !== key),
    })),
  setProgress: (task, id) =>
    set((s) => ({
      progress: task
        ? [...s.progress.filter((p) => p.id !== task.id), task]
        : s.progress.filter((p) => p.id !== id),
    })),
  pushPrompt: (prompt) => set((s) => ({ prompts: [...s.prompts, prompt] })),
  dropPrompt: (id) => set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) })),
  log: (entry) =>
    set((s) => ({
      activity: [...s.activity.slice(-(ACTIVITY_LIMIT - 1)), { ...entry, time: Date.now() }],
    })),
  setTour: (tour) => set({ tour }),
}))

/** Live contributions of one type (typed). */
export function contributionsOf<T extends ContributionType>(
  type: T,
): LiveContribution<Extract<Contribution, { type: T }>>[] {
  return useExtensionsStore
    .getState()
    .contributions.filter((c) => c.contribution.type === type) as LiveContribution<
    Extract<Contribution, { type: T }>
  >[]
}

/** The same, as a React hook (re-renders when contributions change). */
export function useContributions<T extends ContributionType>(
  type: T,
): LiveContribution<Extract<Contribution, { type: T }>>[] {
  const all = useExtensionsStore((s) => s.contributions)
  return useMemo(
    () =>
      all.filter((c) => c.contribution.type === type) as LiveContribution<
        Extract<Contribution, { type: T }>
      >[],
    [all, type],
  )
}

/** Key under which an extension's session things live (`<ext>::<id>`). */
export const scopedKey = (extId: string, id: string): string => `${extId}::${id}`
