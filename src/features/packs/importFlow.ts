import { usePacksStore, type ImportRequest } from "../../stores/packsStore"
import { pickImageFiles } from "./api"

/**
 * Start importing images: the user picks them first, then the import window
 * opens to choose the pack they go to and adjust them. Nothing opens when
 * the picker is cancelled.
 */
export async function startImport(request: Omit<ImportRequest, "files">): Promise<void> {
  const files = await pickImageFiles()
  if (files.length === 0) return
  usePacksStore.getState().openImport({ ...request, files })
}
