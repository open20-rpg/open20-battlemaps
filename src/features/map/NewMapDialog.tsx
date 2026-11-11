import { useState } from "react"
import {
  Button,
  Checkbox,
  Field,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  Stack,
  Text,
} from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuGem, LuMinus, LuPlus } from "react-icons/lu"
import { Modal } from "../../ui/Modal"
import { useTemplates } from "./useTemplates"
import { DEFAULT_TEMPLATES } from "../../lib/templates"
import { useSettingsStore } from "../../stores/settingsStore"
import { DEFAULT_BUILDING_WEAR, type BuildingWear } from "./model/types"

interface NewMapDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (width: number, height: number, buildingWear: BuildingWear) => void
  onOpenAssets: () => void
}

const clampTile = (n: number) => (Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1)

export function NewMapDialog(props: NewMapDialogProps) {
  // Remount the content each time the dialog is (re)opened so every field
  // resets to the first template without any state syncing.
  return <NewMapDialogContent key={String(props.open)} {...props} />
}

function NewMapDialogContent({ open, onOpenChange, onCreate, onOpenAssets }: NewMapDialogProps) {
  const { t } = useTranslation()
  const { templates, addTemplate, removeTemplate } = useTemplates()

  // Start on the first template (the built-ins always come first).
  const first = templates[0] ?? DEFAULT_TEMPLATES[0]
  const [selectedId, setSelectedId] = useState(first.id)
  const [width, setWidth] = useState(first.width)
  const [height, setHeight] = useState(first.height)

  // Nested "New template" dialog.
  const [tplOpen, setTplOpen] = useState(false)
  const [tplName, setTplName] = useState("")
  const [tplWidth, setTplWidth] = useState(20)
  const [tplHeight, setTplHeight] = useState(20)

  const selected = templates.find((tpl) => tpl.id === selectedId)
  const disableWear = useSettingsStore((s) => s.disableBuildingWear)
  const setDisableWear = useSettingsStore((s) => s.setDisableBuildingWear)

  const selectTemplate = (id: string) => {
    setSelectedId(id)
    const tpl = templates.find((t) => t.id === id)
    if (tpl) {
      setWidth(tpl.width)
      setHeight(tpl.height)
    }
  }

  const handleRemove = () => {
    if (!selected || selected.builtin) return
    removeTemplate(selected.id)
    // Fall back to the first built-in template.
    const fallback = DEFAULT_TEMPLATES[0]
    setSelectedId(fallback.id)
    setWidth(fallback.width)
    setHeight(fallback.height)
  }

  const openNewTemplate = () => {
    setTplName("")
    setTplWidth(width)
    setTplHeight(height)
    setTplOpen(true)
  }

  const confirmNewTemplate = () => {
    const name = tplName.trim()
    if (!name) return
    const tpl = addTemplate(name, clampTile(tplWidth), clampTile(tplHeight))
    setTplOpen(false)
    // Select the freshly created template.
    setSelectedId(tpl.id)
    setWidth(tpl.width)
    setHeight(tpl.height)
  }

  const handleOk = () => {
    onCreate(clampTile(width), clampTile(height), disableWear ? "none" : DEFAULT_BUILDING_WEAR)
    onOpenChange(false)
  }

  return (
    <>
      <Modal
        open={open}
        onClose={() => onOpenChange(false)}
        title={t("newMap.title")}
        footer={
          <>
            <Button variant="subtle" onClick={() => onOpenChange(false)}>
              {t("newMap.cancel")}
            </Button>
            <Button colorPalette="brand" onClick={handleOk}>
              {t("newMap.ok")}
            </Button>
          </>
        }
      >
        <Stack gap="4">
          <Text fontSize="sm" fontWeight="semibold" color="fg.muted">
            {t("newMap.mapSize")}
          </Text>

          {/* Template selector with add/remove */}
          <Field.Root>
            <Field.Label>{t("newMap.template")}</Field.Label>
            <HStack w="full" gap="2">
              <NativeSelect.Root size="sm" flex="1">
                <NativeSelect.Field
                  value={selectedId}
                  onChange={(e) => selectTemplate(e.currentTarget.value)}
                >
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name} ({t("newMap.tiles", { w: tpl.width, h: tpl.height })})
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
              <IconButton
                aria-label={t("newMap.addTemplate")}
                size="sm"
                variant="subtle"
                onClick={openNewTemplate}
              >
                <LuPlus />
              </IconButton>
              <IconButton
                aria-label={t("newMap.removeTemplate")}
                size="sm"
                variant="subtle"
                colorPalette="danger"
                disabled={!selected || !!selected.builtin}
                onClick={handleRemove}
              >
                <LuMinus />
              </IconButton>
            </HStack>
          </Field.Root>

          {/* Width / height (auto-filled from the template) */}
          <HStack gap="3" align="flex-end">
            <Field.Root flex="1">
              <Field.Label>{t("newMap.width")}</Field.Label>
              <Input
                type="number"
                min={1}
                size="sm"
                value={width}
                onChange={(e) => setWidth(clampTile(Number(e.currentTarget.value)))}
              />
            </Field.Root>
            <Field.Root flex="1">
              <Field.Label>{t("newMap.height")}</Field.Label>
              <Input
                type="number"
                min={1}
                size="sm"
                value={height}
                onChange={(e) => setHeight(clampTile(Number(e.currentTarget.value)))}
              />
            </Field.Root>
          </HStack>

          <Checkbox.Root
            size="sm"
            checked={disableWear}
            onCheckedChange={(e) => setDisableWear(e.checked === true)}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>{t("newMap.disableBuildingWear")}</Checkbox.Label>
          </Checkbox.Root>

          {/* Shortcut to the assets panel */}
          <Button variant="outline" size="sm" onClick={onOpenAssets}>
            <LuGem />
            {t("newMap.editPacks")}
          </Button>
        </Stack>
      </Modal>

      {/* Nested: create a new template */}
      <Modal
        open={tplOpen}
        onClose={() => setTplOpen(false)}
        title={t("newTemplate.title")}
        size="xs"
        footer={
          <>
            <Button variant="subtle" onClick={() => setTplOpen(false)}>
              {t("newTemplate.cancel")}
            </Button>
            <Button colorPalette="brand" disabled={!tplName.trim()} onClick={confirmNewTemplate}>
              {t("newTemplate.accept")}
            </Button>
          </>
        }
      >
        <Stack gap="3">
          <Field.Root required>
            <Field.Label>{t("newTemplate.name")}</Field.Label>
            <Input
              size="sm"
              value={tplName}
              autoFocus
              onChange={(e) => setTplName(e.currentTarget.value)}
            />
          </Field.Root>
          <HStack gap="3">
            <Field.Root flex="1">
              <Field.Label>{t("newTemplate.width")}</Field.Label>
              <Input
                type="number"
                min={1}
                size="sm"
                value={tplWidth}
                onChange={(e) => setTplWidth(clampTile(Number(e.currentTarget.value)))}
              />
            </Field.Root>
            <Field.Root flex="1">
              <Field.Label>{t("newTemplate.height")}</Field.Label>
              <Input
                type="number"
                min={1}
                size="sm"
                value={tplHeight}
                onChange={(e) => setTplHeight(clampTile(Number(e.currentTarget.value)))}
              />
            </Field.Root>
          </HStack>
        </Stack>
      </Modal>
    </>
  )
}
