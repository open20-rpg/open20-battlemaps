import { getCurrentWindow } from "@tauri-apps/api/window"

/** Toggle the app window's fullscreen mode. */
export async function toggleFullscreen(): Promise<void> {
  const win = getCurrentWindow()
  await win.setFullscreen(!(await win.isFullscreen()))
}
