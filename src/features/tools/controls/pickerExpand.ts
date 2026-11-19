import { createContext, useContext } from "react"

/**
 * Whether an asset picker fills its panel (the rest of the params hidden),
 * and how to toggle it. Panels that can't give it the room provide none:
 * the picker shows no expand button then.
 */
export interface PickerExpand {
  expanded: boolean
  toggle: () => void
}

export const PickerExpandContext = createContext<PickerExpand | null>(null)

export const usePickerExpand = (): PickerExpand | null => useContext(PickerExpandContext)
