import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react"
import { toastAnatomy } from "@chakra-ui/react/anatomy"

/** Undoes Chakra's colored fill for warning/success/error toasts. */
const NEUTRAL_TOAST = {
  bg: "panel.solid",
  color: "fg",
  "--toast-trigger-bg": "colors.bg.muted",
  "--toast-border-color": "colors.panel.border",
}

/**
 * Open20 Battle Maps theme — the Open20 suite's identity: a forced dark
 * chrome (near-black menu bar, charcoal panels) with the suite's crimson
 * accent, #A70909.
 */
const config = defineConfig({
  globalCss: {
    ":root": {
      // Panel translucency, configurable at runtime, e.g.:
      //   document.documentElement.style.setProperty("--panel-alpha", "0.7")
      "--panel-alpha": "0.8",
      "--panel-bg": "rgba(33, 33, 38, var(--panel-alpha))",
      "--panel-header-bg": "rgba(25, 25, 32, var(--panel-alpha))",
    },
    "html, body, #root": {
      height: "100%",
      margin: 0,
      bg: "app.bg",
      color: "fg",
      overflow: "hidden",
      userSelect: "none",
      // Prevent double-tap-to-zoom on touch (pinch is blocked via the viewport meta).
      touchAction: "manipulation",
      textSizeAdjust: "100%",
    },
    "*::-webkit-scrollbar": { width: "10px", height: "10px" },
    "*::-webkit-scrollbar-thumb": {
      background: "#3a3a40",
      borderRadius: "8px",
    },
    "*::-webkit-scrollbar-track": { background: "transparent" },
  },
  theme: {
    slotRecipes: {
      // Every toast on the neutral panel surface; only its icon carries the
      // type's color (a colored fill reads loud over the map).
      toast: {
        slots: toastAnatomy.keys(),
        base: {
          root: {
            bg: "panel.solid",
            color: "fg",
            borderWidth: "1px",
            borderColor: "panel.border",
            "&[data-type=warning]": NEUTRAL_TOAST,
            "&[data-type=success]": NEUTRAL_TOAST,
            "&[data-type=error]": NEUTRAL_TOAST,
          },
          indicator: {
            color: "brand.fg",
            "[data-type=warning] &": { color: "orange.fg" },
            "[data-type=success] &": { color: "green.fg" },
            "[data-type=error] &": { color: "danger.fg" },
          },
        },
      },
    },
    tokens: {
      colors: {
        // Open20 crimson, #A70909 at 600; lighter steps are for text and
        // icons on the dark chrome, where the base red is too dim.
        brand: {
          50: { value: "#fdecec" },
          100: { value: "#f9d0cf" },
          200: { value: "#f0a3a1" },
          300: { value: "#ec7d79" },
          400: { value: "#e0534e" },
          500: { value: "#c41d18" },
          600: { value: "#a70909" },
          700: { value: "#860707" },
          800: { value: "#640505" },
          900: { value: "#430303" },
          950: { value: "#2a0202" },
        },
      },
    },
    semanticTokens: {
      colors: {
        "app.bg": { value: "#141416" },
        "menubar.bg": { value: "#1b1b1d" },
        "menubar.fg": { value: "#e7e7ea" },
        "menubar.fgMuted": { value: "#8a8a90" },
        "menubar.hover": { value: "#2c2c31" },
        "panel.bg": { value: "var(--panel-bg)" },
        "panel.header": { value: "var(--panel-header-bg)" },
        // Always-opaque panel surface (dropdown menus, etc.).
        "panel.solid": { value: "#212126" },
        "panel.border": { value: "#34343c" },
        "panel.rowHover": { value: "#2a2a31" },
        "panel.rowSelected": { value: "#3a1a1c" },
        // Destructive actions (Delete, Remove…): red text and icon on a
        // neutral surface — never a red fill — so they don't read as the
        // crimson brand (primary buttons, active tools, selections).
        danger: {
          solid: { value: "#d6333a" },
          contrast: { value: "#ffffff" },
          // Coral, not the brand's crimson: red text means "destructive" only.
          fg: { value: "#ff7f6a" },
          muted: { value: "#3a3a42" },
          subtle: { value: "#2a2a30" },
          emphasized: { value: "#44444d" },
          focusRing: { value: "#ff7f6a" },
        },
        // Full palette semantics, so `colorPalette="brand"` works on any recipe.
        brand: {
          solid: { value: "{colors.brand.600}" },
          contrast: { value: "#ffffff" },
          fg: { value: "{colors.brand.400}" },
          muted: { value: "{colors.brand.900}" },
          subtle: { value: "{colors.brand.950}" },
          emphasized: { value: "{colors.brand.700}" },
          focusRing: { value: "{colors.brand.500}" },
        },
        // Neutral icon tint (placeholders, empty states).
        "icon.muted": { value: "#8a8a90" },
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)
