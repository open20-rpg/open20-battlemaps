import { Box, Button, Flex, HStack, Icon, Progress, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuCircleAlert, LuCircleCheck, LuFeather } from "react-icons/lu"
import { Modal } from "../../../ui/Modal"
import { formatBytes } from "../../../lib/format"
import { type InstalledPack, type OptimizeProgress, type OptimizeReport } from "../api"
import { useOptimizeRun } from "./useOptimizeRun"

/**
 * "Optimize images" of the chosen packs: what it does and that it can't be
 * undone (asked here, not with a native dialog), then the progress, then
 * how much space it freed. Closing while it runs stops it (what's done stays).
 */
export function OptimizeDialog({
  packs,
  onClose,
}: {
  packs: readonly InstalledPack[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { step, progress, reports, stopping, error, run, stop } = useOptimizeRun(packs)
  const close = step === "running" ? stop : onClose

  const footer =
    step === "confirm" ? (
      <>
        <Button variant="subtle" onClick={onClose}>
          {t("optimize.cancel")}
        </Button>
        <Button colorPalette="brand" onClick={() => void run()}>
          <LuFeather />
          {t("optimize.start")}
        </Button>
      </>
    ) : step === "running" ? (
      <Button variant="subtle" onClick={stop} loading={stopping}>
        {t("optimize.stop")}
      </Button>
    ) : (
      <Button colorPalette="brand" onClick={onClose}>
        {t("optimize.close")}
      </Button>
    )

  return (
    <Modal
      open
      onClose={close}
      title={t("optimize.title")}
      size="md"
      closeOnBackdrop={step !== "running"}
      footer={footer}
    >
      {step === "confirm" && <Confirm packs={packs} />}
      {step === "running" && <Running progress={progress} stopping={stopping} />}
      {step === "done" && <Result reports={reports} error={error} />}
    </Modal>
  )
}

function Confirm({ packs }: { packs: readonly InstalledPack[] }) {
  const { t } = useTranslation()
  return (
    <VStack align="stretch" gap="3">
      <Text fontSize="sm">{t("optimize.intro", { count: packs.length })}</Text>
      <VStack align="stretch" gap="1" maxH="140px" overflowY="auto">
        {packs.map((p) => (
          <HStack
            key={p.id}
            justify="space-between"
            fontSize="sm"
            px="3"
            py="1.5"
            bg="panel.header"
            borderRadius="md"
          >
            <Text truncate>{p.name}</Text>
            <Text color="fg.muted" flexShrink={0}>
              {formatBytes(p.sizeBytes)}
            </Text>
          </HStack>
        ))}
      </VStack>
      <HStack
        align="flex-start"
        gap="2.5"
        p="3"
        borderRadius="md"
        borderWidth="1px"
        borderColor="orange.muted"
        bg="orange.subtle"
      >
        <Icon as={LuCircleAlert} color="orange.fg" boxSize="5" mt="0.5" flexShrink={0} />
        <Box fontSize="sm">
          <Text fontWeight="semibold" color="orange.fg">
            {t("optimize.irreversibleTitle")}
          </Text>
          <Text color="fg">{t("optimize.irreversible", { count: packs.length })}</Text>
        </Box>
      </HStack>
      <Text fontSize="xs" color="fg.muted">
        {t("optimize.timeHint")}
      </Text>
    </VStack>
  )
}

function Running({ progress, stopping }: { progress: OptimizeProgress | null; stopping: boolean }) {
  const { t, i18n } = useTranslation()
  const num = (n: number) => n.toLocaleString(i18n.language)
  const value = progress ? (progress.index / Math.max(1, progress.total)) * 100 : null
  return (
    <VStack align="stretch" gap="3" py="2">
      <Text fontSize="sm" fontWeight="semibold" truncate>
        {progress ? t("optimize.running", { pack: progress.pack }) : t("optimize.preparing")}
      </Text>
      <Progress.Root value={value} size="sm" colorPalette="brand">
        <Progress.Track>
          <Progress.Range />
        </Progress.Track>
      </Progress.Root>
      <Flex justify="space-between" fontSize="xs" color="fg.muted">
        <Text>
          {progress
            ? t("optimize.count", {
                index: num(progress.index),
                total: num(progress.total),
              })
            : ""}
        </Text>
        <Text color="green.fg">
          {progress ? t("optimize.savedSoFar", { size: formatBytes(progress.savedBytes) }) : ""}
        </Text>
      </Flex>
      <Text fontSize="xs" color="fg.subtle">
        {stopping ? t("optimize.stopping") : t("optimize.runningHint")}
      </Text>
    </VStack>
  )
}

function Result({ reports, error }: { reports: readonly OptimizeReport[]; error: string | null }) {
  const { t } = useTranslation()
  const before = reports.reduce((a, r) => a + r.before, 0)
  const after = reports.reduce((a, r) => a + r.after, 0)
  const saved = Math.max(0, before - after)
  const percent = before > 0 ? Math.round((saved / before) * 100) : 0
  const cancelled = reports.some((r) => r.cancelled)
  const title = error
    ? t("optimize.failed")
    : cancelled
      ? t("optimize.stopped")
      : saved > 0
        ? t("optimize.done")
        : t("optimize.nothing")
  return (
    <VStack align="stretch" gap="4" py="1">
      <HStack gap="2.5">
        <Icon
          as={error ? LuCircleAlert : LuCircleCheck}
          color={error ? "danger.fg" : "green.fg"}
          boxSize="6"
        />
        <Text fontWeight="semibold">{title}</Text>
      </HStack>
      {saved > 0 && (
        <Box textAlign="center" py="3" borderRadius="md" bg="panel.header">
          <Text fontSize="sm" color="fg.muted">
            {t("optimize.saved")}
          </Text>
          <Text fontSize="3xl" fontWeight="bold" color="green.fg" lineHeight="1.2">
            {formatBytes(saved)}
          </Text>
          <Text fontSize="sm" color="fg.muted">
            {t("optimize.percentLess", { percent })}
          </Text>
        </Box>
      )}
      <VStack align="stretch" gap="1">
        {reports.map((r) => (
          <HStack
            key={r.pack.id}
            justify="space-between"
            fontSize="sm"
            px="3"
            py="1.5"
            bg="panel.header"
            borderRadius="md"
          >
            <Text truncate>{r.pack.name}</Text>
            <Text flexShrink={0}>
              <Text as="span" color="fg.muted">
                {formatBytes(r.before)}
              </Text>
              {" → "}
              <Text as="span" fontWeight="semibold">
                {formatBytes(r.after)}
              </Text>
            </Text>
          </HStack>
        ))}
      </VStack>
      {error && (
        <Text fontSize="xs" color="danger.fg">
          {error}
        </Text>
      )}
      {cancelled && !error && (
        <Text fontSize="xs" color="fg.muted">
          {t("optimize.stoppedHint")}
        </Text>
      )}
    </VStack>
  )
}
