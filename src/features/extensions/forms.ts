import { type ParamSpec } from "@open20/battlemaps-sdk"

/** The defaults of a list of params, as a values bag. */
export function defaultsOf(specs: readonly ParamSpec[] | undefined): Record<string, unknown> {
  return Object.fromEntries(
    (specs ?? [])
      .filter((p) => p.kind !== "button")
      .map((p) => [p.key, "default" in p ? p.default : null]),
  )
}
