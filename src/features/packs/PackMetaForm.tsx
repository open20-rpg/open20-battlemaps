import { useState } from "react"
import { Box, Button, Input, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { FieldLabel } from "./AdjustFields"
import { parseTags } from "./userAssets"
import { type InstalledPack, type PackMeta } from "./api"

/** A pack's manifest as the form edits it (keywords as typed). */
interface MetaDraft {
  name: string
  author: string
  version: string
  keywords: string
}

const draftOf = (pack?: InstalledPack | null): MetaDraft => ({
  name: pack?.name ?? "",
  author: pack?.author ?? "",
  version: pack?.version ?? "1.0.0",
  keywords: pack?.keywords.join(", ") ?? "",
})

/**
 * Name, author, version and keywords of a user pack (what Dungeondraft
 * shows of it). `submitLabel` names the action (create, save).
 */
export function PackMetaForm({
  pack,
  submitLabel,
  busy = false,
  onSubmit,
  autoFocus = false,
}: {
  pack?: InstalledPack | null
  submitLabel: string
  busy?: boolean
  onSubmit: (meta: PackMeta) => void
  autoFocus?: boolean
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(() => draftOf(pack))
  const set = (patch: Partial<MetaDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const initial = draftOf(pack)
  const changed = !pack || JSON.stringify(initial) !== JSON.stringify(draft)
  const submit = () =>
    onSubmit({
      name: draft.name.trim(),
      author: draft.author.trim(),
      version: draft.version.trim(),
      keywords: parseTags(draft.keywords),
    })

  return (
    <VStack
      as="form"
      align="stretch"
      gap="3"
      onSubmit={(e) => {
        e.preventDefault()
        if (draft.name.trim() && changed) submit()
      }}
    >
      <Box>
        <FieldLabel>{t("userPacks.packName")}</FieldLabel>
        <Input
          mt="1"
          size="sm"
          value={draft.name}
          aria-label={t("userPacks.packName")}
          placeholder={t("userPacks.packNameHint")}
          autoFocus={autoFocus}
          onChange={(e) => set({ name: e.currentTarget.value })}
        />
      </Box>
      <Box>
        <FieldLabel>{t("userPacks.author")}</FieldLabel>
        <Input
          mt="1"
          size="sm"
          value={draft.author}
          aria-label={t("userPacks.author")}
          placeholder={t("userPacks.authorHint")}
          onChange={(e) => set({ author: e.currentTarget.value })}
        />
      </Box>
      <Box>
        <FieldLabel>{t("userPacks.version")}</FieldLabel>
        <Input
          mt="1"
          size="sm"
          value={draft.version}
          aria-label={t("userPacks.version")}
          placeholder="1.0.0"
          onChange={(e) => set({ version: e.currentTarget.value })}
        />
      </Box>
      <Box>
        <FieldLabel>{t("userPacks.keywords")}</FieldLabel>
        <Input
          mt="1"
          size="sm"
          value={draft.keywords}
          aria-label={t("userPacks.keywords")}
          placeholder={t("userPacks.keywordsHint")}
          onChange={(e) => set({ keywords: e.currentTarget.value })}
        />
      </Box>
      {pack && (
        <Text fontSize="2xs" color="fg.subtle">
          {t("userPacks.packId", { id: pack.id })}
        </Text>
      )}
      <Button
        type="submit"
        size="sm"
        colorPalette="brand"
        disabled={!draft.name.trim() || !changed}
        loading={busy}
      >
        {submitLabel}
      </Button>
    </VStack>
  )
}
