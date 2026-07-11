import { create } from "zustand"

export interface LoadingTask {
  id: string
  message: string
  /** 0..100 when known, undefined for an indeterminate task. */
  progress?: number
}

/** Fields callers may change on an in-flight task. */
export type LoadingPatch = Partial<Omit<LoadingTask, "id">>

interface LoadingState {
  tasks: LoadingTask[]
  /** Begin a task; returns its id. */
  start: (message: string, progress?: number) => string
  /** Update a task's message/progress. No-op if it already finished. */
  update: (id: string, patch: LoadingPatch) => void
  /** Finish a task. */
  stop: (id: string) => void
}

let seq = 0

export const useLoadingStore = create<LoadingState>()((set) => ({
  tasks: [],
  start: (message, progress) => {
    const id = `t${++seq}`
    set((s) => ({ tasks: [...s.tasks, { id, message, progress }] }))
    return id
  },
  update: (id, patch) =>
    set((s) => ({
      tasks: s.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    })),
  stop: (id) => set((s) => ({ tasks: s.tasks.filter((task) => task.id !== id) })),
}))

export const useIsLoading = (): boolean => useLoadingStore((s) => s.tasks.length > 0)

/**
 * Run an async function as a tracked task. The task is stopped automatically
 * when the promise settles (even on error). The callback receives an `update`
 * helper so long jobs can report progress/message changes. Callable from
 * anywhere (stores, event handlers) — not just components.
 */
export async function withLoading<T>(
  message: string,
  fn: (update: (patch: LoadingPatch) => void) => Promise<T>,
): Promise<T> {
  const { start, update, stop } = useLoadingStore.getState()
  const id = start(message)
  try {
    return await fn((patch) => update(id, patch))
  } finally {
    stop(id)
  }
}
