import { useState } from "react"
import { Button, Flex, Stack, Switch, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useMapStore } from "../../stores/mapStore"
import { toaster } from "../../ui/chakra/toaster-instance"
import { Modal } from "../../ui/Modal"
import { Select } from "../../ui/Select"
import { exportPngFlow } from "./io"
import { exportPxPerTile } from "./render/exportMap"

const RESOLUTIONS = [64, 128, 256]

/** Export the map as a PNG image: pick the resolution and whether to include the grid. */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [pxPerTile, setPxPerTile] = useState(128)
  const [grid, setGrid] = useState(true)
  const map = useMapStore((s) => s.map)
  const ppt = map ? exportPxPerTile(pxPerTile, map.width, map.height) : pxPerTile

  const run = async () => {
    try {
      if (await exportPngFlow({ pxPerTile, grid })) {
        toaster.create({ title: t("toast.exported"), type: "success" })
        onClose()
      }
    } catch (err) {
      toaster.create({ title: t("toast.exportError", { error: String(err) }), type: "error" })
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("export.title")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("export.cancel")}
          </Button>
          <Button colorPalette="blue" onClick={() => void run()} disabled={!map}>
            {t("export.export")}
          </Button>
        </>
      }
    >
      <Stack gap="4">
        <Flex align="center" justify="space-between" gap="4">
          <Text fontSize="sm">{t("export.resolution")}</Text>
          <Select
            value={String(pxPerTile)}
            items={RESOLUTIONS.map((r) => ({
              value: String(r),
              label: t("export.pxPerTile", { px: r }),
            }))}
            onChange={(v) => setPxPerTile(Number(v))}
          />
        </Flex>
        <Flex align="center" justify="space-between">
          <Text fontSize="sm">{t("export.includeGrid")}</Text>
          <Switch.Root checked={grid} onCheckedChange={(e) => setGrid(e.checked)}>
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </Flex>
        {map && (
          <Text fontSize="xs" color="fg.muted">
            {t("export.size", { w: map.width * ppt, h: map.height * ppt })}
            {ppt < pxPerTile ? ` — ${t("export.capped")}` : ""}
          </Text>
        )}
      </Stack>
    </Modal>
  )
}
