import { createContext, useContext, useMemo, useState, type ReactNode } from "react"

/** The object currently hovered (mouse) or pressed (touch) in the library. */
export interface ObjectPreview {
  name: string
  /** Ready-to-use thumbnail URL — shown immediately while the full loads. */
  thumbUrl: string
  /** Ready-to-use full-size image URL (recolored already if applicable). */
  fullUrl: string
}

interface PreviewContextValue {
  preview: ObjectPreview | null
  setPreview: (p: ObjectPreview | null) => void
}

const PreviewContext = createContext<PreviewContextValue | null>(null)

/**
 * Holds the object preview currently requested by the library (hover/press).
 * The library sets it; the {@link ObjectPreview} panel next to the tools panel
 * reads it. Kept in a context because those two live in different subtrees.
 */
export function PreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<ObjectPreview | null>(null)
  const value = useMemo(() => ({ preview, setPreview }), [preview])
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
}

export function usePreview(): PreviewContextValue {
  const ctx = useContext(PreviewContext)
  if (!ctx) throw new Error("usePreview must be used within a <PreviewProvider>")
  return ctx
}
