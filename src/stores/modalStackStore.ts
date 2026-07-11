import { useEffect, useId } from "react"
import { create } from "zustand"

interface ModalStackState {
  stack: string[]
  push: (id: string) => void
  remove: (id: string) => void
}

/**
 * Tracks the order in which modals open. Only the last-opened modal is shown;
 * the ones below stay mounted but hidden. This replaces per-modal z-index
 * juggling — layering follows open order, and a single backdrop belongs to the
 * top modal, so clicking it closes only that one.
 */
export const useModalStackStore = create<ModalStackState>()((set) => ({
  stack: [],
  push: (id) => set((s) => (s.stack.includes(id) ? s : { stack: [...s.stack, id] })),
  remove: (id) => set((s) => ({ stack: s.stack.filter((x) => x !== id) })),
}))

/**
 * Registers a modal layer on the stack while `open` is true and reports whether
 * it is currently the topmost (and therefore the visible/interactive) one.
 */
export function useModalLayer(open: boolean): { active: boolean; isTop: boolean } {
  const id = useId()

  useEffect(() => {
    if (!open) return
    useModalStackStore.getState().push(id)
    return () => useModalStackStore.getState().remove(id)
  }, [open, id])

  const isTop = useModalStackStore((s) => s.stack[s.stack.length - 1] === id)
  return { active: open && isTop, isTop }
}
