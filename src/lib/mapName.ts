/**
 * A map file's name for lists, without the folder or `.otbm`. Android's
 * picker gives `content://` URIs with the real path percent-encoded in them
 * ("…/document/primary%3ADownload%2Fmap.otbm"), so those are decoded first.
 */
export function mapFileName(path: string): string {
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // Not percent-encoded after all: use it as it is.
  }
  const last = decoded.split(/[\\/:]/).pop() || decoded
  return last.replace(/\.otbm$/i, "") || last
}
