import { create } from "zustand"

/** The object currently hovered (mouse) or pressed (touch) in the library. */
export interface ObjectPreviewData {
  name: string
  /** Ready-to-use thumbnail URL — shown immediately while the full loads. */
  thumbUrl: string
  /** Ready-to-use full-size image URL (recolored already if applicable). */
  fullUrl: string
}

interface PreviewState {
  /** Set by the library on hover/press; read by the preview panel. */
  preview: ObjectPreviewData | null
  setPreview: (p: ObjectPreviewData | null) => void
}

export const usePreviewStore = create<PreviewState>()((set) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
}))
