/**
 * Shortcut actions that live in the app shell (file dialogs, saving):
 * App registers its handlers here while mounted, so the shortcut dispatcher
 * can run them without importing React state.
 */
type AppActionId = "newMap" | "open" | "save" | "saveAs" | "export"

let handlers: Partial<Record<AppActionId, () => void>> = {}

export const APP_ACTIONS: readonly string[] = ["newMap", "open", "save", "saveAs", "export"]

export function registerAppActions(next: Partial<Record<AppActionId, () => void>>): () => void {
  handlers = next
  return () => {
    if (handlers === next) handlers = {}
  }
}

/** Run app action `id` if one is registered; whether it ran. */
export function runAppAction(id: string): boolean {
  const fn = handlers[id as AppActionId]
  if (!fn) return false
  fn()
  return true
}
