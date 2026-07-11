import { Box, Flex, HStack, Icon, Portal, Spinner, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuCircleCheck } from "react-icons/lu"
import { Tooltip } from "./ui/tooltip"
import { useLoading } from "../context/loading"
import { useMap } from "../context/map"
import { useTools } from "../context/tools"

/** Height of the status bar; the app reserves this much space at the bottom. */
export const STATUS_BAR_HEIGHT = "26px"

/** A thin vertical divider between status-bar items. */
function Sep() {
  return <Box w="1px" h="14px" bg="panel.border" mx="2.5" flexShrink={0} />
}

function TaskDetails() {
  const { tasks } = useLoading()
  const { t } = useTranslation()
  return (
    <VStack align="stretch" gap="1.5" minW="180px" maxW="320px">
      <Text fontSize="xs" fontWeight="bold" color="fg.muted">
        {t("status.processes")}
      </Text>
      {tasks.map((task) => (
        <HStack key={task.id} justify="space-between" gap="4">
          <Text fontSize="xs" truncate>
            {task.message}
          </Text>
          {typeof task.progress === "number" && (
            <Text fontSize="xs" color="fg.muted" flexShrink={0}>
              {Math.round(task.progress)}%
            </Text>
          )}
        </HStack>
      ))}
    </VStack>
  )
}

export function StatusBar() {
  const { tasks, isLoading } = useLoading()
  const { hasMap } = useMap()
  const { activeTool } = useTools()
  const { t } = useTranslation()

  // Overall progress = average of tasks that report a percentage.
  const withPct = tasks.filter((task) => typeof task.progress === "number")
  const overall =
    withPct.length > 0
      ? Math.round(withPct.reduce((sum, task) => sum + (task.progress ?? 0), 0) / withPct.length)
      : null

  const label = isLoading
    ? tasks.length > 1
      ? t("status.loadingCount", { count: tasks.length })
      : t("status.loading")
    : t("status.ready")

  return (
    <Portal>
      <Flex
        as="footer"
        position="fixed"
        bottom="0"
        left="0"
        right="0"
        h={STATUS_BAR_HEIGHT}
        // Above modal overlays/dialogs so the status bar is always visible.
        zIndex="max"
        flexShrink={0}
        align="center"
        px="3"
        bg="menubar.bg"
        borderTopWidth="1px"
        borderColor="panel.border"
        fontSize="xs"
        color="menubar.fgMuted"
      >
        {/* App identity on the far left */}
        <Text fontWeight="medium" color="menubar.fgMuted">
          OpenDraft v{__APP_VERSION__}
        </Text>

        {/* Current tool (only when a map is open and a tool is picked) */}
        {hasMap && activeTool && (
          <>
            <Sep />
            <HStack gap="1.5" color="menubar.fg">
              <Icon as={activeTool.icon} boxSize="3.5" color="brand.fg" />
              <Text>{t(activeTool.nameKey)}</Text>
            </HStack>
          </>
        )}

        {/* Middle reserved for future status data (coords, zoom, etc.) */}
        <Box flex="1" />

        {/* Loading indicator — always right-aligned. Details show on hover only. */}
        <Sep />
        <Tooltip
          content={<TaskDetails />}
          disabled={!isLoading}
          openDelay={100}
          closeDelay={100}
          positioning={{ placement: "top-end" }}
          contentProps={{
            color: "fg",
            borderWidth: "1px",
            borderColor: "panel.border",
            zIndex: "max",
            // The recipe derives the content bg AND the arrow fill/border from
            // --tooltip-bg, so override that (not bg/--arrow-background).
            css: { "--tooltip-bg": "#212126" },
          }}
          showArrow
        >
          <HStack gap="1.5" px="1.5" h="full" color={isLoading ? "menubar.fg" : "menubar.fgMuted"}>
            {isLoading ? (
              <Spinner size="xs" color="brand.fg" borderWidth="1.5px" />
            ) : (
              <Icon as={LuCircleCheck} boxSize="3.5" color="green.400" />
            )}
            <Text>{label}</Text>
            {overall !== null && <Text color="fg.muted">{overall}%</Text>}
          </HStack>
        </Tooltip>
      </Flex>
    </Portal>
  )
}
