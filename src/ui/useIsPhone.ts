import { useSyncExternalStore } from "react"

/**
 * Phone screens (portrait phones, up to 600 CSS px wide) get the app's phone
 * layout; anything wider keeps the desktop one.
 */
export const PHONE_QUERY = "(max-width: 600px)"

const query = () => (typeof window === "undefined" ? null : window.matchMedia(PHONE_QUERY))

function subscribe(onChange: () => void): () => void {
  const mq = query()
  mq?.addEventListener("change", onChange)
  return () => mq?.removeEventListener("change", onChange)
}

/** Whether the window is phone-sized (follows resizes and rotations). */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  )
}
