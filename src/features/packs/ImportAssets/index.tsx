import { useMemo, useState } from "react"
import { Box, Flex, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuImagePlus } from "react-icons/lu"
import { FloatingWindow } from "../../../ui/FloatingWindow"
import { useIsPhone } from "../../../ui/useIsPhone"
import { usePacksStore, type ImportRequest } from "../../../stores/packsStore"
import { thumbUrl } from "../../library/api"
import { type ImportQuality } from "../api"
import { AssetPreview } from "./AssetPreview"
import { DestinationField } from "./Destination"
import { toImportItem, type Draft } from "./drafts"
import { ImportFooter } from "./ImportFooter"
import { ImportList } from "./ImportList"
import { ImportSettings } from "./ImportSettings"
import { useDestination } from "./useDestination"
import { useDrafts } from "./useDrafts"
import { isPreview, useImportPreviews, type PreviewState } from "./useImportPreviews"
import { useImportRun, type ImportFailure } from "./useImportRun"

/** The import window, open while the store holds a request. */
export function ImportAssetsHost() {
  const request = usePacksStore((s) => s.importRequest)
  const close = usePacksStore((s) => s.closeImport)
  // A new request (another picker asked) starts from scratch.
  return request ? (
    <ImportAssets key={request.files.join("\n")} request={request} onClose={close} />
  ) : null
}

/**
 * Import picked images into a pack of the user's: the list on the left
 * (click one to adjust it, check several to adjust them together), the
 * focused one previewed on the grid as it will be on the map, its settings
 * on the right. On a phone the three stack.
 */
function ImportAssets({ request, onClose }: { request: ImportRequest; onClose: () => void }) {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const list = useDrafts(request.files, request.category)
  const dest = useDestination(request.packId)
  const [quality, setQuality] = useState<ImportQuality>("balanced")
  const runner = useImportRun({ onImported: request.onImported, onDone: onClose })

  const { drafts } = list
  const sources = useMemo(
    () => drafts.flatMap((d) => [d.source, ...Object.values(d.parts)]),
    [drafts],
  )
  const previews = useImportPreviews(sources)

  const readable = drafts.filter((d) => isPreview(previews.get(d.source)))
  const unreadable = drafts.filter((d) => previews.has(d.source)).length - readable.length
  const pending = drafts.length - readable.length - unreadable
  const canImport = !runner.busy && readable.length > 0 && pending === 0 && dest.name !== ""

  const runImport = async () => {
    const stayOn = await runner.run(dest.dest, dest.name, readable.map(toImportItem), quality)
    // Nothing went in, but a new pack was made: it's the destination now.
    if (stayOn) dest.setDest(stayOn)
  }

  const listView = (
    <ImportList
      drafts={drafts}
      previews={previews}
      checked={list.checked}
      focused={list.focusedDraft?.key ?? null}
      onRowClick={list.clickRow}
      onToggle={list.toggle}
      onToggleAll={list.toggleAll}
      onAdd={() => void list.addFiles(request.category)}
      onRemoveChecked={list.removeChecked}
      maxH={phone ? "30vh" : undefined}
    />
  )
  const preview = (
    <PreviewPane draft={list.focusedDraft} previews={previews} empty={drafts.length === 0} />
  )
  const settings = <ImportSettings list={list} previews={previews} packInfo={dest.info} />
  const destination = (
    <Box p="3" borderBottomWidth="1px" borderColor="panel.border">
      <DestinationField d={dest} />
    </Box>
  )

  return (
    <FloatingWindow
      title={t("userPacks.importTitle")}
      icon={LuImagePlus}
      onClose={runner.busy ? () => undefined : onClose}
      initialSize={{ w: 1040, h: 680 }}
      minSize={{ w: 360, h: 420 }}
      resizable
      modal
      closeOnBackdropClick={false}
    >
      <Failures failures={runner.failures} />
      {phone ? (
        <Flex direction="column" flex="1" minH="0">
          {/* Pinned above what scrolls: every adjustment shows whole, right away. */}
          <Flex h="200px" flexShrink={0} borderBottomWidth="1px" borderColor="panel.border">
            {preview}
          </Flex>
          <Flex direction="column" flex="1" minH="0" overflowY="auto">
            {destination}
            {listView}
            {settings}
          </Flex>
        </Flex>
      ) : (
        <Flex flex="1" minH="0">
          <Flex
            direction="column"
            w="280px"
            flexShrink={0}
            borderRightWidth="1px"
            borderColor="panel.border"
          >
            {destination}
            {listView}
          </Flex>
          <Flex flex="1" minW="0">
            {preview}
          </Flex>
          <Box
            w="320px"
            flexShrink={0}
            overflowY="auto"
            borderLeftWidth="1px"
            borderColor="panel.border"
          >
            {settings}
          </Box>
        </Flex>
      )}
      <ImportFooter
        quality={quality}
        onQuality={setQuality}
        progress={runner.progress}
        pending={pending}
        unreadable={unreadable}
        count={readable.length}
        busy={runner.busy}
        canImport={canImport}
        onCancel={onClose}
        onImport={() => void runImport()}
      />
    </FloatingWindow>
  )
}

/** The focused image on the grid, or why there's nothing to show. */
function PreviewPane({
  draft,
  previews,
  empty,
}: {
  draft: Draft | null
  previews: ReadonlyMap<string, PreviewState>
  empty: boolean
}) {
  const { t } = useTranslation()
  const p = draft ? previews.get(draft.source) : undefined
  if (draft && isPreview(p)) {
    return (
      <AssetPreview
        image={{ url: thumbUrl(p.path), width: p.width, height: p.height, bounds: p.bounds }}
        adjust={draft.adjust}
        category={draft.category}
      />
    )
  }
  const message =
    p && !isPreview(p)
      ? t("userPacks.unreadableHint", { error: p.error })
      : empty
        ? t("userPacks.noImages")
        : t("userPacks.reading")
  return (
    <Flex flex="1" minH="160px" align="center" justify="center" color="fg.muted" p="6">
      <Text fontSize="sm" textAlign="center">
        {message}
      </Text>
    </Flex>
  )
}

function Failures({ failures }: { failures: readonly ImportFailure[] }) {
  if (failures.length === 0) return null
  return (
    <Box px="4" py="2" bg="danger.subtle" borderBottomWidth="1px" borderColor="panel.border">
      {failures.slice(0, 5).map((f) => (
        <Text key={f.name + f.error} fontSize="xs" color="danger.fg">
          {f.name}: {f.error}
        </Text>
      ))}
    </Box>
  )
}
