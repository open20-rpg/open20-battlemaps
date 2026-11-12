/**
 * Whether the app runs on a phone or tablet (Android, iOS/iPadOS), judged by
 * the webview's user agent. iPadOS reports itself as a Mac, so a "Mac" with a
 * touch screen counts as an iPad.
 */
export function isMobilePlatform(
  nav: { userAgent: string; maxTouchPoints?: number } | undefined = globalThis.navigator,
): boolean {
  if (!nav) return false
  if (/Android|iPhone|iPad|iPod/i.test(nav.userAgent)) return true
  return /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1
}
