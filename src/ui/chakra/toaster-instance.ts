import { createToaster } from "@chakra-ui/react"

/**
 * The imperative toast API (`toaster.create(...)`). Lives apart from the
 * <Toaster /> component so each file exports one kind of thing and Vite's
 * fast refresh keeps working on both.
 */
export const toaster = createToaster({
  placement: "bottom-end",
  pauseOnPageIdle: true,
})
