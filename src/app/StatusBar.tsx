import { Box, Flex, HStack, Icon, Portal, Spinner, Text, VStack } from "@chakra-ui/react"
import { ExtensionStatus } from "../features/extensions/ui/ExtensionStatus"
import { useTranslation } from "react-i18next"
import { LuCircleCheck } from "react-icons/lu"
import { Tooltip } from "../ui/chakra/tooltip"
import { BrandMark } from "./BrandMark"
import { useIsPhone } from "../ui/useIsPhone"
import { STATUS_BAR_HEIGHT } from "../ui/layout"
import { useIsLoading, useLoadingStore } from "../stores/loadingStore"
import { useHasMap } from "../stores/mapStore"
import { useMapDirty, useMapFilePath } from "../stores/mapFileStore"
import { useActiveTool } from "../stores/toolsStore"
import { UpdateNotice } from "../features/open20/UpdateNotice"

/** A thin vertical divider between status-bar items. */
function Sep() {
  return <Box w="1px" h="14px" bg="panel.border" mx="2.5" flexShrink={0} />
}

function TaskDetails() {
  const tasks = useLoadingStore((s) => s.tasks)
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

/**
 * The status bar's left side: the app, the open file and the active tool.
 * A phone keeps just the mark and the file: the bar must fit one line.
 */
function StatusIdentity() {
  const hasMap = useHasMap()
  const filePath = useMapFilePath()
  const dirty = useMapDirty()
  const activeTool = useActiveTool()
  const phone = useIsPhone()
  const { t } = useTranslation()
  const fileName = filePath ? (filePath.split(/[\\/]/).pop() ?? filePath) : t("status.untitled")
  return (
    <>
      {/* App identity on the far left (a phone keeps just the mark: the bar must fit one line) */}
      <BrandMark variant="battleMaps" boxSize="3.5" mr="1.5" color="menubar.fg" flexShrink={0} />
      {!phone && (
        <Text fontWeight="medium" color="menubar.fgMuted" whiteSpace="nowrap">
          {t("about.version", { version: __APP_VERSION__ })}
        </Text>
      )}
      {!phone && <UpdateNotice />}

      {/* Current file (only when a map is open) */}
      {hasMap && (
        <>
          {!phone && <Sep />}
          <Text color="menubar.fg" truncate minW="0">
            {fileName}
            {dirty ? " •" : ""}
          </Text>
        </>
      )}

      {/* Current tool (only when a map is open and a tool is picked) */}
      {hasMap && activeTool && !phone && (
        <>
          <Sep />
          <HStack gap="1.5" color="menubar.fg">
            <Icon as={activeTool.icon} boxSize="3.5" color="brand.fg" />
            <Text>{t(activeTool.nameKey)}</Text>
          </HStack>
        </>
      )}
    </>
  )
}

/**
 * On a phone the status bar would take a strip of the map for a "Ready"
 * nobody reads: only what's loading shows, as a pill over the top of the map.
 */
function PhoneLoadingPill({ label }: { label: string }) {
  return (
    <Portal>
      <HStack
        position="fixed"
        top="52px"
        left="50%"
        transform="translateX(-50%)"
        zIndex="max"
        gap="1.5"
        px="3"
        py="1.5"
        borderRadius="full"
        bg="menubar.bg"
        borderWidth="1px"
        borderColor="panel.border"
        fontSize="xs"
        color="menubar.fg"
        boxShadow="md"
      >
        <Spinner size="xs" color="brand.fg" borderWidth="1.5px" />
        <Text whiteSpace="nowrap">{label}</Text>
      </HStack>
    </Portal>
  )
}

export function StatusBar() {
  const tasks = useLoadingStore((s) => s.tasks)
  const isLoading = useIsLoading()
  const phone = useIsPhone()
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

  if (phone) return isLoading ? <PhoneLoadingPill label={tasks[0]?.message ?? label} /> : null

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
        <StatusIdentity />

        {/* Middle: what extensions show (their items and running tasks). */}
        <Box flex="1" minW="0" px="2">
          <ExtensionStatus />
        </Box>

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
            <Text whiteSpace="nowrap">{label}</Text>
            {overall !== null && <Text color="fg.muted">{overall}%</Text>}
          </HStack>
        </Tooltip>
      </Flex>
    </Portal>
  )
}
