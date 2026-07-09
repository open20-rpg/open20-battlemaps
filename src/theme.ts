import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react"

/**
 * OpenDraft theme — a forced dark chrome that mirrors Dungeondraft's look:
 * a near-black top menu bar, dark charcoal panels and a blue accent.
 */
const config = defineConfig({
  globalCss: {
    ":root": {
      // Panel translucency, configurable at runtime, e.g.:
      //   document.documentElement.style.setProperty("--panel-alpha", "0.7")
      "--panel-alpha": "0.5",
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
    },
    "*::-webkit-scrollbar": { width: "10px", height: "10px" },
    "*::-webkit-scrollbar-thumb": {
      background: "#3a3a40",
      borderRadius: "8px",
    },
    "*::-webkit-scrollbar-track": { background: "transparent" },
  },
  theme: {
    tokens: {
      colors: {
        brand: {
          400: { value: "#5aa9ff" },
          500: { value: "#3d8bfd" },
          600: { value: "#2f6fd6" },
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
        "panel.rowSelected": { value: "#26364f" },
        brand: {
          solid: { value: "{colors.brand.500}" },
          contrast: { value: "#ffffff" },
          fg: { value: "{colors.brand.400}" },
          emphasized: { value: "{colors.brand.600}" },
        },
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)
