/**
 * @open20/battlemaps-sdk — build safe extensions for Open20 Battle Maps.
 *
 * Extensions run in an isolated sandbox and reach the app only through the
 * context `activate` receives; every call is checked against the
 * permissions the user granted.
 *
 *   import { defineExtension } from "@open20/battlemaps-sdk"
 *   export default defineExtension({
 *     async activate(ctx) {
 *       await ctx.ui.command({ id: "hello", title: "Hola", run: () => ctx.ui.notify("¡Hola!") })
 *     },
 *   })
 *
 * This is the package's entry point (a library needs one); the helpers
 * live in their own modules (`/geometry`, `/random`, `/color`, `/testing`).
 */
export { defineExtension, runExtension } from "./runtime"
export type { Disposable, ExtensionContext, ExtensionDefinition } from "./runtime"
export { API_VERSION, localize, validateManifest } from "./manifest"
export type { Manifest, LocalizedText, ActivationEvent, Contributes, SettingSpec } from "./manifest"
export { PERMISSIONS, isPermission } from "./permissions"
export type { Permission } from "./permissions"
export { ExtensionError } from "./protocol"
export type * from "./types"
export type * from "./contributions"
export { CONTRIBUTION_PERMISSIONS } from "./contributions"
