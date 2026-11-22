import { Box, Button, HStack, Progress, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { localize, type Contribution } from "@open20/battlemaps-sdk"
import { Tooltip } from "../../../ui/chakra/tooltip"
import { useExtensionsStore, type LiveContribution } from "../../../stores/extensionsStore"

/** Extensions' items and running tasks, in the status bar. */
export function ExtensionStatus() {
  const items = useExtensionsStore((s) => s.statusItems)
  const progress = useExtensionsStore((s) => s.progress)
  const contributions = useExtensionsStore((s) => s.contributions)
  const clickOf = (key: string) => {
    const c = contributions.find(
      (x) => x.contribution.type === "statusItem" && `${x.extId}::${x.contribution.id}` === key,
    ) as LiveContribution<Extract<Contribution, { type: "statusItem" }>> | undefined
    return c?.contribution.onClick
  }
  return (
    <HStack gap="2" minW="0">
      {progress.map((p) => (
        <HStack key={p.id} gap="1.5" minW="0">
          <Text fontSize="xs" truncate maxW="40">
            {p.title}
            {p.message ? ` · ${p.message}` : ""}
          </Text>
          <Box w="16">
            <Progress.Root
              value={p.value === null ? null : p.value * 100}
              size="xs"
              colorPalette="brand"
            >
              <Progress.Track>
                <Progress.Range />
              </Progress.Track>
            </Progress.Root>
          </Box>
        </HStack>
      ))}
      {Object.entries(items).map(([key, item]) => {
        const onClick = clickOf(key)
        const label = (
          <Button
            key={key}
            size="2xs"
            variant="ghost"
            disabled={!onClick}
            onClick={() => onClick && void Promise.resolve(onClick()).catch(() => {})}
          >
            {item.text}
          </Button>
        )
        return item.tooltip ? (
          <Tooltip key={key} content={item.tooltip}>
            {label}
          </Tooltip>
        ) : (
          label
        )
      })}
    </HStack>
  )
}

/** A tour of an extension: one step at a time, pointing at a part of the app. */
export function TourOverlay() {
  const { t, i18n } = useTranslation()
  const tour = useExtensionsStore((s) => s.tour)
  const c = useExtensionsStore((s) => s.contributions.find((x) => x.key === tour?.key)) as
    LiveContribution<Extract<Contribution, { type: "tour" }>> | undefined
  if (!tour || !c) return null
  const steps = c.contribution.steps
  const step = steps[tour.step]
  if (!step) return null
  const go = (n: number) =>
    useExtensionsStore
      .getState()
      .setTour(n >= 0 && n < steps.length ? { key: tour.key, step: n } : null)
  const target = TOUR_TARGETS[String(step.target).split(":")[0]] ?? TOUR_TARGETS.canvas
  return (
    <Box
      position="fixed"
      zIndex="toast"
      bg="panel.solid"
      borderWidth="1px"
      borderColor="brand.solid"
      borderRadius="md"
      p="3"
      maxW="80"
      boxShadow="lg"
      role="dialog"
      aria-label={localize(c.contribution.title, i18n.language)}
      {...target}
    >
      <Text fontSize="xs" color="fg.muted">
        {localize(c.contribution.title, i18n.language)} · {tour.step + 1}/{steps.length}
      </Text>
      <Text fontSize="sm" my="2">
        {localize(step.text, i18n.language)}
      </Text>
      <HStack justify="flex-end">
        <Button size="2xs" variant="ghost" onClick={() => go(-1)}>
          {t("extensions.tourEnd")}
        </Button>
        {tour.step > 0 && (
          <Button size="2xs" variant="outline" onClick={() => go(tour.step - 1)}>
            {t("extensions.tourBack")}
          </Button>
        )}
        <Button size="2xs" colorPalette="brand" onClick={() => go(tour.step + 1)}>
          {tour.step + 1 < steps.length ? t("extensions.tourNext") : t("extensions.tourDone")}
        </Button>
      </HStack>
    </Box>
  )
}

/** Where each tour target sits on screen (the app's fixed layout). */
const TOUR_TARGETS: Record<string, Record<string, string>> = {
  tools: { left: "80px", top: "120px" },
  tool: { left: "80px", top: "120px" },
  toolPanel: { left: "340px", top: "120px" },
  library: { right: "24px", top: "120px" },
  canvas: { left: "50%", top: "40%", transform: "translateX(-50%)" },
  menu: { left: "24px", top: "56px" },
  statusBar: { left: "24px", bottom: "40px" },
  viewControls: { left: "80px", bottom: "48px" },
  panel: { right: "24px", top: "120px" },
}
