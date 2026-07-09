import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

export interface LoadingTask {
  id: string
  message: string
  /** 0..100 when known, undefined for an indeterminate task. */
  progress?: number
}

/** Fields callers may change on an in-flight task. */
export type LoadingPatch = Partial<Omit<LoadingTask, "id">>

interface LoadingContextValue {
  tasks: LoadingTask[]
  isLoading: boolean
  /** Begin a task; returns its id. */
  start: (message: string, progress?: number) => string
  /** Update a task's message/progress. No-op if it already finished. */
  update: (id: string, patch: LoadingPatch) => void
  /** Finish a task. */
  stop: (id: string) => void
  /**
   * Run an async function as a tracked task. The task is stopped automatically
   * when the promise settles (even on error). The callback receives an
   * `update` helper so long jobs can report progress/message changes.
   */
  withLoading: <T>(
    message: string,
    fn: (update: (patch: LoadingPatch) => void) => Promise<T>,
  ) => Promise<T>
}

const LoadingContext = createContext<LoadingContextValue | null>(null)

let seq = 0

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<LoadingTask[]>([])
  // Keep the latest tasks for imperative callers if ever needed.
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  const start = useCallback((message: string, progress?: number) => {
    const id = `t${++seq}`
    setTasks((prev) => [...prev, { id, message, progress }])
    return id
  }, [])

  const update = useCallback((id: string, patch: LoadingPatch) => {
    setTasks((prev) =>
      prev.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    )
  }, [])

  const stop = useCallback((id: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== id))
  }, [])

  const withLoading = useCallback(
    async <T,>(
      message: string,
      fn: (update: (patch: LoadingPatch) => void) => Promise<T>,
    ): Promise<T> => {
      const id = `t${++seq}`
      setTasks((prev) => [...prev, { id, message }])
      try {
        return await fn((patch) => update(id, patch))
      } finally {
        stop(id)
      }
    },
    [update, stop],
  )

  const value = useMemo<LoadingContextValue>(
    () => ({ tasks, isLoading: tasks.length > 0, start, update, stop, withLoading }),
    [tasks, start, update, stop, withLoading],
  )

  return <LoadingContext.Provider value={value}>{children}</LoadingContext.Provider>
}

export function useLoading(): LoadingContextValue {
  const ctx = useContext(LoadingContext)
  if (!ctx) {
    throw new Error("useLoading must be used within a <LoadingProvider>")
  }
  return ctx
}
