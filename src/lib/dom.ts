/** Whether keyboard input is aimed at a text field (shortcuts must not fire). */
export function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
}
