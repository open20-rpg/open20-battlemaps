import { getCurrentWindow } from "@tauri-apps/api/window"

/** Toggle the app window's fullscreen mode. */
export async function toggleFullscreen(): Promise<void> {
  const win = getCurrentWindow()
  await win.setFullscreen(!(await win.isFullscreen()))
}

/**
 * Run `confirm` when the user asks to close the app window: the window
 * closes only if it resolves true. Returns the unsubscribe function.
 */
export async function onAppCloseRequested(confirm: () => Promise<boolean>): Promise<() => void> {
  const win = getCurrentWindow()
  return win.onCloseRequested(async (event) => {
    // Decide synchronously to keep it open, then close it ourselves if allowed.
    event.preventDefault()
    if (await confirm()) await win.destroy()
  })
}
