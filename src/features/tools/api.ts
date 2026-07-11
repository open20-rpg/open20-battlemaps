import { invoke } from "@tauri-apps/api/core"

/** Installed OS font family names, sorted (for the Text tool's font selector). */
export function listSystemFonts(): Promise<string[]> {
  return invoke("list_system_fonts")
}
