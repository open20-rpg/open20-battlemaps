/**
 * Export formats and the file-size estimate, as plain data/maths (the
 * dialog, the render and the backend all share them).
 */

/** Image formats the export writes; JPEG carries its quality (1–100). The shape is the backend's. */
export type ExportFormat = { kind: "png" } | { kind: "jpeg"; quality: number } | { kind: "webp" }

export type ExportFormatKind = ExportFormat["kind"]

export const EXPORT_FORMATS: readonly ExportFormatKind[] = ["png", "jpeg", "webp"]

export const FORMAT_EXTENSION: Record<ExportFormatKind, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
}

/** Formats that keep transparency (JPEG has no alpha). */
export const supportsTransparency = (kind: ExportFormatKind): boolean => kind !== "jpeg"

export const DEFAULT_JPEG_QUALITY = 90

/** Exported pixels per tile to choose from. */
export const EXPORT_RESOLUTIONS = [32, 64, 100, 128, 200, 256] as const

/** Longest side, in px, of the sample encoded to estimate the file size. */
export const SAMPLE_MAX_PX = 512

/**
 * The file size of the whole image from a sample of it encoded the same
 * way: the sample's bytes per pixel times the image's pixels. Exact when
 * the sample is the whole image.
 */
export function estimateBytes(
  sampleBytes: number,
  samplePixels: number,
  imagePixels: number,
): number {
  if (samplePixels <= 0) return 0
  return Math.round((sampleBytes / samplePixels) * imagePixels)
}

/** "512 KB", "12.3 MB"… (binary units, one decimal from MB up). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
