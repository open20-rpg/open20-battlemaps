import { useState } from "react"
import { Box, Flex, HStack, Icon, Spinner, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuCircleCheck } from "react-icons/lu"
import { Tooltip } from "./ui/tooltip"
import { useLoading } from "../context/loading"

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
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

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
    <Flex
      as="footer"
      h="26px"
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

      {/* Middle reserved for future status data (coords, zoom, etc.) */}
      <Box flex="1" />

      {/* Loading indicator — always right-aligned */}
      <Tooltip
        content={<TaskDetails />}
        disabled={!isLoading}
        open={isLoading && open}
        onOpenChange={(e) => setOpen(e.open)}
        openDelay={100}
        closeDelay={100}
        contentProps={{ bg: "panel.bg", color: "fg", borderWidth: "1px", borderColor: "panel.border" }}
        showArrow
      >
        <HStack
          as="button"
          gap="1.5"
          px="1.5"
          h="full"
          cursor={isLoading ? "pointer" : "default"}
          color={isLoading ? "menubar.fg" : "menubar.fgMuted"}
          _hover={{ color: "menubar.fg" }}
          onClick={() => setOpen((v) => !v)}
        >
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
  )
}
