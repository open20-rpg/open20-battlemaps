import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react"

interface ModalStackValue {
  stack: string[]
  push: (id: string) => void
  remove: (id: string) => void
}

const ModalStackContext = createContext<ModalStackValue | null>(null)

/**
 * Tracks the order in which modals open. Only the last-opened modal is shown;
 * the ones below stay mounted but hidden. This replaces per-modal z-index
 * juggling — layering follows open order, and a single backdrop belongs to the
 * top modal, so clicking it closes only that one.
 */
export function ModalStackProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<string[]>([])

  const push = useCallback((id: string) => {
    setStack((s) => (s.includes(id) ? s : [...s, id]))
  }, [])

  const remove = useCallback((id: string) => {
    setStack((s) => s.filter((x) => x !== id))
  }, [])

  const value = useMemo(() => ({ stack, push, remove }), [stack, push, remove])

  return <ModalStackContext.Provider value={value}>{children}</ModalStackContext.Provider>
}

function useModalStack(): ModalStackValue {
  const ctx = useContext(ModalStackContext)
  if (!ctx) {
    throw new Error("modal components must be used within a <ModalStackProvider>")
  }
  return ctx
}

/**
 * Registers a modal layer on the stack while `open` is true and reports whether
 * it is currently the topmost (and therefore the visible/interactive) one.
 */
export function useModalLayer(open: boolean): { active: boolean; isTop: boolean } {
  const { stack, push, remove } = useModalStack()
  const id = useId()

  useEffect(() => {
    if (!open) return
    push(id)
    return () => remove(id)
  }, [open, id, push, remove])

  const isTop = stack[stack.length - 1] === id
  return { active: open && isTop, isTop }
}
