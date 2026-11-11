import { useId } from "react"
import { chakra, type HTMLChakraProps } from "@chakra-ui/react"

/**
 * The Open20 marks (sources: src/assets/brand/): a d20 whose right
 * wall swings open like a door, in the brand crimson. "suite" keeps the
 * die's facets (Open20); "battleMaps" swaps them for a route that comes in
 * through the door to an X (Open20 Battle Maps). Drawn inline so the
 * outline follows the text color and the crimson the brand token.
 */
const OUTLINE = "M88.1,28 L50,6 L11.9,28 L11.9,72 L50,94 L88.1,72"
const FACETS =
  "M50,6 L50,30 L88.1,28 M50,30 L29,66 L71,66 Z M11.9,28 L50,30 M11.9,28 L29,66 L11.9,72 M29,66 L50,94 L71,66 L88.1,72 M71,66 L88.1,28"
/** The door's sweep: facets don't show through it. */
const SWEEP = "M88.1,72 L50,50 L88.1,28 Z"
const DOOR = "M88.1,28 L50,50"
const ROUTE = "M96,60 C80,62 70,78 54,74 S40,56 34,52"
const X = "M23,37 l10,10 m0,-10 l-10,10"

const CRIMSON = "var(--chakra-colors-brand-solid)"
const line = { fill: "none", strokeLinejoin: "round", strokeLinecap: "round" } as const

export function BrandMark({
  variant,
  ...props
}: { variant: "suite" | "battleMaps" } & HTMLChakraProps<"svg">) {
  const mask = useId()
  return (
    <chakra.svg viewBox="0 0 100 100" aria-hidden="true" {...props}>
      <path d={OUTLINE} stroke="currentColor" strokeWidth={6.5} {...line} />
      {variant === "suite" ? (
        <>
          <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            <rect width="100" height="100" fill="white" />
            <path d={SWEEP} fill="black" />
          </mask>
          <path
            d={FACETS}
            stroke="currentColor"
            strokeOpacity={0.45}
            strokeWidth={2.6}
            mask={`url(#${mask})`}
            {...line}
          />
        </>
      ) : (
        <>
          <path
            d={ROUTE}
            stroke="currentColor"
            strokeOpacity={0.7}
            strokeWidth={4}
            strokeDasharray="0.1 8"
            {...line}
          />
          <path d={X} stroke={CRIMSON} strokeWidth={4.5} {...line} />
        </>
      )}
      <path d={SWEEP} fill={CRIMSON} fillOpacity={0.18} />
      <path d={DOOR} stroke={CRIMSON} strokeWidth={6.5} {...line} />
    </chakra.svg>
  )
}
