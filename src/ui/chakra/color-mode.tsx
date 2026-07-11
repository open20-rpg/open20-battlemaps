import { ThemeProvider, type ThemeProviderProps } from "next-themes"

export type ColorModeProviderProps = ThemeProviderProps

/**
 * Theme-mode bridge (next-themes). The app currently forces dark mode (see
 * provider.tsx); reintroduce toggling helpers here if/when themes become a
 * real preference.
 */
export function ColorModeProvider(props: ColorModeProviderProps) {
  return <ThemeProvider attribute="class" disableTransitionOnChange {...props} />
}
