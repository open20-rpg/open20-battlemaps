import { Flex, Icon } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { localize, type Contribution } from "@open20/battlemaps-sdk"
import { Tooltip } from "../../../ui/chakra/tooltip"
import { useExtensionsStore, type LiveContribution } from "../../../stores/extensionsStore"
import { extensionIcon } from "../icons"

type Toggle = LiveContribution<Extract<Contribution, { type: "viewToggle" }>>
type Particles = LiveContribution<Extract<Contribution, { type: "particles" }>>

/** One button per view toggle extensions add (overlays, particle effects). */
export function ExtensionToggles() {
  const { i18n } = useTranslation()
  const all = useExtensionsStore((s) => s.contributions)
  const state = useExtensionsStore((s) => s.viewToggles)
  const toggles = all.filter(
    (c): c is Toggle | Particles =>
      c.contribution.type === "viewToggle" ||
      (c.contribution.type === "particles" && !!c.contribution.toggle),
  )
  return (
    <>
      {toggles.map((c) => {
        const isToggle = c.contribution.type === "viewToggle"
        const on =
          state[c.key] ?? (isToggle ? (c.contribution as Toggle["contribution"]).default : true)
        const label = localize(c.contribution.name, i18n.language)
        const icon = extensionIcon(
          isToggle ? (c.contribution as Toggle["contribution"]).icon : "LuSparkles",
        )
        return (
          <Tooltip
            key={c.key}
            content={label}
            positioning={{ placement: "right" }}
            openDelay={200}
            showArrow
          >
            <Flex
              as="button"
              align="center"
              justify="center"
              boxSize="38px"
              borderRadius="md"
              flexShrink={0}
              color={on ? "brand.fg" : "menubar.fg"}
              bg={on ? "panel.rowSelected" : "transparent"}
              _hover={{ bg: on ? "panel.rowSelected" : "panel.rowHover" }}
              aria-label={label}
              aria-pressed={on}
              onClick={() => {
                useExtensionsStore.getState().setViewToggle(c.key, !on)
                if (isToggle)
                  void Promise.resolve(
                    (c.contribution as Toggle["contribution"]).onChange(!on),
                  ).catch(() => {})
              }}
            >
              <Icon as={icon} boxSize="5" />
            </Flex>
          </Tooltip>
        )
      })}
    </>
  )
}
