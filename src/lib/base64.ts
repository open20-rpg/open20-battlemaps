/** Bytes per chunk handed to String.fromCharCode (its arguments are bounded). */
const CHUNK = 0x8000

/** Bytes as base64, in chunks: big buffers (image rows) can't go through one call. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
