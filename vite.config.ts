import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import pkg from "./package.json" with { type: "json" }

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Expose the app version (single source of truth: package.json) to the client.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Builds for app stores (Google Play…): the store updates the app and
    // doesn't allow outside payment links, so those parts are left out.
    __STORE_BUILD__: JSON.stringify(process.env.OPEN20_STORE_BUILD === "1"),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}))
